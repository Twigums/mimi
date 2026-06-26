module StoryCompiler (storyCompiler) where

import Data.Char (toLower)
import Data.List (intercalate, isPrefixOf, partition)
import Hakyll

splitOn :: Char -> String -> [String]
splitOn _ "" = [""]
splitOn c (x:xs) = case splitOn c xs of
    []     -> [[x]]
    (r:rs) -> if x == c then "" : r : rs else (x : r) : rs

readDouble :: String -> String -> Either String Double
readDouble name s = case reads (trim s) of
    [(v, "")] -> Right v
    _         -> Left $ "Invalid number for '" ++ name ++ "': " ++ s

showNum :: Double -> String
showNum d
    | d == fromIntegral n = show n
    | otherwise           = show d
  where n = round d :: Int

escapeJson :: String -> String
escapeJson = concatMap esc
  where
    esc '"'  = "\\\""
    esc '\\' = "\\\\"
    esc c    = [c]

-- Optional per-segment style directives carried as a key/value map (e.g.
-- color=#fff, font=handwriting, scale=1.6, in=grow, motion=sway, pulse=beat).
-- A bare flag (no '=') becomes key="true" (e.g. `autotime`).
type Style = [(String, String)]

parseStyleTok :: String -> (String, String)
parseStyleTok t = case break (== '=') (trim t) of
    (k, '=':v) -> (trim k, trim v)
    (k, _)     -> (trim k, "true")

isNumericTok :: String -> Bool
isNumericTok t = case reads (trim t) :: [(Double, String)] of
    [(_, "")] -> True
    _         -> False

renderStyle :: Style -> String
renderStyle []  = ""
renderStyle kvs = ", \"style\": { " ++ intercalate ", " (map kv kvs) ++ " }"
  where kv (k, v) = "\"" ++ escapeJson k ++ "\": \"" ++ escapeJson v ++ "\""

data StoryEntry
    = HighlightEntry { heFrom :: Double, heTo :: Double }
    | MoveEntry      { meTime :: Double, meX :: Double, meY :: Double, meStyle :: Style }
    | ExcludeEntry   { exFrom :: Double, exTo :: Double }
    | ReactiveEntry  { reModes :: [String] }
    | LyricEntry     { leFrom :: Double, leTo :: Double
                     , leX :: Double, leY :: Double
                     , leText :: String, leChars :: [Double], leStyle :: Style }

parseEntry :: String -> Either String StoryEntry
parseEntry line
    | (k, ':':rest) <- break (== ':') (trim line), map toLower (trim k) == "reactive" =
        Right $ ReactiveEntry (words rest)
    | otherwise = case map trim (splitOn ',' line) of
        ["h", t1, t2]  -> do
            from <- readDouble "time1" t1
            to   <- readDouble "time2" t2
            Right $ HighlightEntry from to
        ("m":t:x:y:rest) -> do
            time <- readDouble "time" t
            nx   <- readDouble "x"    x
            ny   <- readDouble "y"    y
            Right $ MoveEntry time nx ny (map parseStyleTok rest)
        ["x", t1, t2]  -> do
            from <- readDouble "time1" t1
            to   <- readDouble "time2" t2
            Right $ ExcludeEntry from to
        ("l":fromS:toS:xS:yS:textS:rest) -> do
            from <- readDouble "from"      fromS
            to   <- readDouble "to"        toS
            nx   <- readDouble "x"         xS
            ny   <- readDouble "y"         yS
            -- Numeric trailing tokens are per-char activation times; the rest
            -- (k=v or bare flags like `autotime`) are style directives.
            let (numToks, styleToks) = partition isNumericTok rest
            cs   <- mapM (readDouble "char_time") numToks
            Right $ LyricEntry from to nx ny (trim textS) cs (map parseStyleTok styleToks)
        _ -> Left $ "Expected 'h, t1, t2', 'm, t, x, y[, style...]', 'x, t1, t2', 'reactive: ...', or 'l, from, to, x, y, text[, char_times/style...]': " ++ line

renderEntry :: StoryEntry -> String
renderEntry (HighlightEntry from to) =
    "  { \"type\": \"highlight\", \"from\": " ++ showNum from ++ ", \"to\": " ++ showNum to ++ " }"
renderEntry (MoveEntry time x y style) =
    "  { \"type\": \"move\", \"time\": " ++ showNum time ++ ", \"x\": " ++ showNum x ++ ", \"y\": " ++ showNum y ++ renderStyle style ++ " }"
renderEntry (ExcludeEntry from to) =
    "  { \"type\": \"exclude\", \"from\": " ++ showNum from ++ ", \"to\": " ++ showNum to ++ " }"
renderEntry (ReactiveEntry modes) =
    "  { \"type\": \"reactive\", \"modes\": [" ++ intercalate ", " (map (\m -> "\"" ++ escapeJson m ++ "\"") modes) ++ "] }"
renderEntry (LyricEntry from to x y text chars style) =
    "  { \"type\": \"lyric\", \"from\": " ++ showNum from ++ ", \"to\": " ++ showNum to ++
    ", \"x\": " ++ showNum x ++ ", \"y\": " ++ showNum y ++
    ", \"text\": \"" ++ escapeJson text ++ "\"" ++
    ", \"chars\": [" ++ intercalate ", " (map showNum chars) ++ "]" ++ renderStyle style ++ " }"

compileStory :: String -> Either String String
compileStory content = do
    let ls = filter isDataLine (lines content)
    entries <- mapM parseEntry ls
    Right $ "[\n" ++ intercalate ",\n" (map renderEntry entries) ++ "\n]\n"
  where
    isDataLine l = let t = trim l in not (null t) && not ("#" `isPrefixOf` t)

storyCompiler :: Compiler (Item String)
storyCompiler = do
    body <- getResourceBody
    case compileStory (itemBody body) of
        Left  err  -> fail $ "Story compile error: " ++ err
        Right json -> makeItem json
