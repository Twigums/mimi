module ChartCompiler (chartCompiler) where

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

parseLyricField :: String -> Either String (Maybe String, Maybe Int, Maybe Double)
parseLyricField raw = go (words (trim raw)) (Nothing, Nothing, Nothing)
  where
    go [] acc = Right acc
    go (t:ts) (mc, ms, mt)
        | "span=" `isPrefixOf` map toLower t =
            case reads (drop 5 t) of
                [(n, "")] | n > 0 -> go ts (mc, Just (n :: Int), mt)
                _                 -> Left $ "Invalid span (need positive integer): " ++ t
        | "src=" `isPrefixOf` map toLower t =
            case reads (drop 4 t) of
                [(d, "")] -> go ts (mc, ms, Just (d :: Double))
                _         -> Left $ "Invalid src (need a timestamp in ms): " ++ t
        | otherwise = go ts (Just (maybe t (\c -> c ++ " " ++ t) mc), ms, mt)

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
    }

parseNote :: (Double -> Double) -> String -> Either String NoteEntry
parseNote toMs line =
    case map trim (splitOn ',' line) of
        [k, t, d, x, y]    -> go k t d x y Nothing
        [k, t, d, x, y, c] -> go k t d x y (Just c)
        _                   -> Left $ "Expected 5 or 6 comma-separated fields: " ++ line
  where
    go k t d x y mLyric = do
        t'  <- readDouble "time" t
        nx  <- readDouble "x"    x
        ny  <- readDouble "y"    y
        (mChar, mSpan, mSrcTime) <- maybe (Right (Nothing, Nothing, Nothing)) parseLyricField mLyric
        (radians, pinned) <- case map toLower (trim d) of
            ""     -> Right (0.0, False)
            "auto" -> Right (0.0, False)
            ds     -> do
                deg <- readDouble "degrees" ds
                Right (normalizeAngle (-(deg * pi / 180.0)), True)
        let kind = case map toLower k of
                "c"     -> "cut"
                "cut"   -> "cut"
                "f"     -> "flow"
                "flow"  -> "flow"
                "l"     -> "lyric"
                "lyric" -> "lyric"
                _       -> map toLower k
        let timeMs  = toMs t'
        Right $ NoteEntry kind timeMs nx ny radians pinned False mChar mSpan mSrcTime

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