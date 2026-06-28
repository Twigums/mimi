module ChartCompiler (chartCompiler) where

import Control.Monad (foldM)
import Data.Char (toLower)
import Data.List (intercalate, isPrefixOf)
import Hakyll

splitOn :: Char -> String -> [String]
splitOn _ "" = [""]
splitOn c (x:xs) = case splitOn c xs of
    []     -> [[x]]
    (r:rs) -> if x == c then "" : r : rs else (x : r) : rs

parseHeaderLine :: String -> Maybe (String, String)
parseHeaderLine line = case break (== ':') (trim line) of
    (key, ':':val) -> Just (trim key, trim val)
    _              -> Nothing

lookupHeader :: String -> [String] -> Either String String
lookupHeader key ls =
    case [v | l <- ls, Just (k, v) <- [parseHeaderLine l], k == key] of
        (v:_) -> Right v
        []    -> Left $ "Missing header field: " ++ key

lookupHeaderDef :: String -> String -> [String] -> String
lookupHeaderDef key def ls =
    case [v | l <- ls, Just (k, v) <- [parseHeaderLine l], k == key] of
        (v:_) -> v
        []    -> def

readDouble :: String -> String -> Either String Double
readDouble name s = case reads (trim s) of
    [(v, "")] -> Right v
    _         -> Left $ "Invalid number for '" ++ name ++ "': " ++ s

data NoteEntry = NoteEntry
    { neKind            :: String
    , neTimeMs          :: Double
    , neX               :: Double
    , neY               :: Double
    , neDirection       :: Double
    , neDirectionPinned :: Bool
    , neNewCombo        :: Bool
    , neLyricChar       :: Maybe String
    , neLyricSpan       :: Maybe Int
    , neLyricSrcTime    :: Maybe Double
    , neIncludeEndChar  :: Bool
    }

data LyricOptions = LyricOptions
    { loChar           :: Maybe String
    , loSpan           :: Maybe Int
    , loSrcTime        :: Maybe Double
    , loIncludeEndChar :: Bool
    }

emptyLyricOptions :: LyricOptions
emptyLyricOptions = LyricOptions Nothing Nothing Nothing False

normalizeKind :: String -> String
normalizeKind k = case map toLower (trim k) of
    "c"     -> "cut"
    "cut"   -> "cut"
    "f"     -> "flow"
    "flow"  -> "flow"
    "l"     -> "lyric"
    "lyric" -> "lyric"
    other   -> other

parseLyricOptions :: String -> String -> [String] -> Either String LyricOptions
parseLyricOptions _ _ [] = Right emptyLyricOptions
parseLyricOptions line k opts
    | normalizeKind k /= "lyric" =
        Left $ "Lyric options are only valid on lyric rows: " ++ line
    | otherwise = foldM parseOpt emptyLyricOptions (concatMap words opts)
  where
    parseOpt acc raw
        | null opt = Right acc
        | isEndChar opt = Right acc { loIncludeEndChar = True }
        | "span=" `isPrefixOf` lower =
            case reads (drop 5 opt) of
                [(n, "")] | n > 0 && loSpan acc == Nothing -> Right acc { loSpan = Just (n :: Int) }
                [(n, "")] | n > 0 -> Left $ "Duplicate lyric span in: " ++ line
                _ -> Left $ "Invalid span (need positive integer): " ++ opt
        | "src=" `isPrefixOf` lower =
            case reads (drop 4 opt) of
                [(d, "")] | loSrcTime acc == Nothing -> Right acc { loSrcTime = Just (d :: Double) }
                [(_, "")] -> Left $ "Duplicate lyric src in: " ++ line
                _ -> Left $ "Invalid src (need a timestamp in ms): " ++ opt
        | otherwise =
            case break (== '=') opt of
                (key, '=':value)
                    | map toLower (trim key) == "char" -> setChar acc (trim value)
                    | otherwise -> Left $ "Unknown lyric option '" ++ trim key ++ "' in: " ++ line
                _ -> setChar acc opt
      where
        opt = trim raw
        lower = map toLower opt

    isEndChar s = map toLower (trim s) == "endchar"

    -- Legacy charts used a bare sixth field for the lyric override. Keep accepting that,
    -- but new charts should spell it as `char=...` so flags and overrides do not collide.
    setChar acc c
        | null (trim c) = Right acc
        | loChar acc == Nothing = Right acc { loChar = Just (trim c) }
        | otherwise = Right acc { loChar = Just (loCharText ++ " " ++ trim c) }
      where
        loCharText = maybe "" id (loChar acc)

parseNote :: (Double -> Double) -> String -> Either String NoteEntry
parseNote toMs line =
    case map trim (splitOn ',' line) of
        -- An `end` marker carries only a time; it bounds a preceding lyric's hold and is
        -- stripped by the engine, so it needs no position/direction.
        [k, t] | map toLower k == "end" -> do
            t' <- readDouble "time" t
            Right $ NoteEntry "end" (toMs t') 0 0 0 False False Nothing Nothing Nothing False
        (k:t:d:x:y:opts) -> do
            lyricOpts <- parseLyricOptions line k opts
            go k t d x y lyricOpts
        _ -> Left $ "Expected `end, time`, or at least 5 comma-separated fields: " ++ line
  where
    go k t d x y lyricOpts = do
        t'  <- readDouble "time" t
        nx  <- readDouble "x"    x
        ny  <- readDouble "y"    y
        (radians, pinned) <- case map toLower (trim d) of
            ""     -> Right (0.0, False)
            "auto" -> Right (0.0, False)
            ds     -> do
                deg <- readDouble "degrees" ds
                Right (normalizeAngle (-(deg * pi / 180.0)), True)
        let kind = normalizeKind k
        let timeMs  = toMs t'
        -- newCombo is set by `parseEntries` when a `break` precedes this note (phrase
        -- boundary and combo-side hint for flow tangent heading).
        Right $ NoteEntry kind timeMs nx ny radians pinned False
            (loChar lyricOpts) (loSpan lyricOpts) (loSrcTime lyricOpts) (loIncludeEndChar lyricOpts)

-- Fold the data lines into notes, treating a `break` line as a phrase boundary
parseEntries :: (Double -> Double) -> [String] -> Either String [NoteEntry]
parseEntries toMs = go False
  where
    go _ [] = Right []
    go brk (l:ls)
        | map toLower (trim l) == "break" = go True ls
        | otherwise = do
            n  <- parseNote toMs l
            ns <- go False ls
            Right (n { neNewCombo = brk } : ns)

normalizeAngle :: Double -> Double
normalizeAngle a
    | a >  pi   = normalizeAngle (a - 2 * pi)
    | a <= (-pi) = normalizeAngle (a + 2 * pi)
    | otherwise  = if a == 0 then 0 else a

showNum :: Double -> String
showNum d
    | d == fromIntegral n = show n
    | otherwise           = show d
  where n = round d :: Int

renderNote :: NoteEntry -> String
renderNote n
    | neKind n == "end" =
        "  { \"kind\": \"end\", \"time\": " ++ showNum (neTimeMs n) ++ ", \"state\": \"pending\" }"
renderNote n =
    "  { \"kind\": \""     ++ neKind n                ++ "\"" ++
    ", \"time\": "         ++ showNum (neTimeMs    n) ++
    ", \"x\": "            ++ showNum (neX         n) ++
    ", \"y\": "            ++ showNum (neY         n) ++
    ", \"direction\": "    ++ show    (neDirection n) ++
    (if neDirectionPinned n then ", \"directionPinned\": true" else "") ++
    (if neNewCombo n then ", \"newCombo\": true" else "") ++
    maybe "" (\c -> ", \"lyricChar\": \"" ++ c ++ "\"") (neLyricChar n) ++
    maybe "" (\sp -> ", \"lyricSpan\": " ++ show sp) (neLyricSpan n) ++
    maybe "" (\st -> ", \"lyricSrcTime\": " ++ showNum st) (neLyricSrcTime n) ++
    (if neIncludeEndChar n then ", \"includeEndChar\": true" else "") ++
    ", \"state\": \"pending\" }"

compileChart :: String -> Either String String
compileChart content = do
    let ls        = lines content
        hLines    = takeWhile (not . null . trim) ls
        rest      = dropWhile (null . trim) (drop (length hLines) ls)
        noteLines = filter isDataLine rest
        timeUnit  = map toLower $ lookupHeaderDef "time_unit" "beat" hLines
    toMs <- case timeUnit of
        "ms"   -> Right id
        "beat" -> do
            bpm <- lookupHeader "bpm"    hLines >>= readDouble "bpm"
            off <- lookupHeader "offset" hLines >>= readDouble "offset"
            Right $ \beat -> off + (beat - 1.0) * (60000.0 / bpm)
        other  -> Left $ "Unknown time_unit: " ++ other
    notes <- parseEntries toMs noteLines
    Right $ "[\n" ++ intercalate ",\n" (map renderNote notes) ++ "\n]\n"
  where
    isDataLine l = let t = trim l
                   in not (null t) && not ("#" `isPrefixOf` t)

chartCompiler :: Compiler (Item String)
chartCompiler = do
    body <- getResourceBody
    case compileChart (itemBody body) of
        Left  err  -> fail $ "Chart compile error: " ++ err
        Right json -> makeItem json
