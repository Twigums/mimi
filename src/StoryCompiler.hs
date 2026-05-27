module StoryCompiler (storyCompiler) where

import Data.List (intercalate, isPrefixOf)
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

data StoryEntry
    = HighlightEntry { heFrom :: Double, heTo :: Double }
    | MoveEntry      { meTime :: Double, meX :: Double, meY :: Double }
    | LyricEntry     { leFrom :: Double, leTo :: Double
                     , leX :: Double, leY :: Double
                     , leText :: String, leChars :: [Double] }

parseEntry :: String -> Either String StoryEntry
parseEntry line = case map trim (splitOn ',' line) of
    ["h", t1, t2]  -> do
        from <- readDouble "time1" t1
        to   <- readDouble "time2" t2
        Right $ HighlightEntry from to
    ["m", t, x, y] -> do
        time <- readDouble "time" t
        nx   <- readDouble "x"    x
        ny   <- readDouble "y"    y
        Right $ MoveEntry time nx ny
    ("l":fromS:toS:xS:yS:textS:charStrs) -> do
        from <- readDouble "from"      fromS
        to   <- readDouble "to"        toS
        nx   <- readDouble "x"         xS
        ny   <- readDouble "y"         yS
        cs   <- mapM (readDouble "char_time") charStrs
        Right $ LyricEntry from to nx ny (trim textS) cs
    _ -> Left $ "Expected 'h, t1, t2', 'm, t, x, y', or 'l, from, to, x, y, text[, char_times...]': " ++ line

renderEntry :: StoryEntry -> String
renderEntry (HighlightEntry from to) =
    "  { \"type\": \"highlight\", \"from\": " ++ showNum from ++ ", \"to\": " ++ showNum to ++ " }"
renderEntry (MoveEntry time x y) =
    "  { \"type\": \"move\", \"time\": " ++ showNum time ++ ", \"x\": " ++ showNum x ++ ", \"y\": " ++ showNum y ++ " }"
renderEntry (LyricEntry from to x y text chars) =
    "  { \"type\": \"lyric\", \"from\": " ++ showNum from ++ ", \"to\": " ++ showNum to ++
    ", \"x\": " ++ showNum x ++ ", \"y\": " ++ showNum y ++
    ", \"text\": \"" ++ escapeJson text ++ "\"" ++
    ", \"chars\": [" ++ intercalate ", " (map showNum chars) ++ "] }"

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
