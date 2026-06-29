{-# LANGUAGE OverloadedStrings #-}
import Data.Char            (toLower)
import Data.List            (dropWhileEnd, intercalate, isPrefixOf)
import Data.Maybe           (catMaybes, fromMaybe, mapMaybe)
import System.Directory     (doesDirectoryExist, doesFileExist, listDirectory)
import System.Environment   (getArgs, lookupEnv, withArgs)
import System.FilePath      ((</>), (<.>), takeBaseName)
import Control.Monad        (filterM, forM)
import GHC.IO.Encoding        (setLocaleEncoding, utf8)

import Hakyll

import ChartCompiler  (chartCompiler)
import StoryCompiler  (storyCompiler)
import Compilers      (sassCompiler, tsCompiler)
import Config        (hakyllConfig, templateDir, textaliveToken)


--------------------------------------------------------------------------------

makePattern :: FilePath -> FilePath -> Pattern
makePattern dir glob = fromGlob (dir </> glob)

makeIdentifier :: FilePath -> FilePath -> Identifier
makeIdentifier dir file = fromFilePath (dir </> file)

escapeForAttr :: String -> String
escapeForAttr = concatMap escape
  where
    escape '&'  = "&amp;"
    escape '<'  = "&lt;"
    escape '>'  = "&gt;"
    escape '"'  = "&quot;"
    escape '\'' = "&#39;"
    escape c    = [c]

escapeForJson :: String -> String
escapeForJson = concatMap escape
  where
    escape '"'  = "\\\""
    escape '\\' = "\\\\"
    escape c    = [c]

extractSitePath :: [String] -> (String, [String])
extractSitePath = go []
  where
    go acc []                    = ("", reverse acc)
    go acc ("--path" : p : rest) = (p, reverse acc ++ rest)
    go acc (a : rest)            = go (a : acc) rest

normalizeSitePath :: String -> String
normalizeSitePath ""   = ""
normalizeSitePath path =
    let stripped = dropWhile (== '/') path
        trimmed  = dropWhileEnd (== '/') stripped
    in "/" ++ trimmed

normalizeOrigin :: String -> String
normalizeOrigin "" = "http://localhost"
normalizeOrigin s  = dropWhileEnd (== '/') s

--------------------------------------------------------------------------------

safeTrim :: String -> String
safeTrim = dropWhileEnd (== ' ') . dropWhile (== ' ')

splitOn :: Char -> String -> [String]
splitOn _ "" = [""]
splitOn c (x:xs) = case splitOn c xs of
    []     -> [[x]]
    (r:rs) -> if x == c then "" : r : rs else (x : r) : rs

parseHeader :: String -> Maybe (String, String)
parseHeader line = case break (== ':') line of
    (key, ':':val) -> Just (safeTrim key, safeTrim val)
    _              -> Nothing

parseFrontmatter :: String -> [(String, String)]
parseFrontmatter content =
    let ls = lines content
        afterDelim = drop 1 $ dropWhile (/= "---") ls
        fmLines = takeWhile (/= "---") afterDelim
    in map parseLine fmLines
  where
    parseLine line = case break (== ':') line of
        (key, ':':val) -> (safeTrim key, safeTrim val)
        _              -> ("", "")

lookupFM :: String -> [(String, String)] -> String
lookupFM key fm = fromMaybe "" $ lookup key fm

difficultyIds :: [String]
difficultyIds = ["easy", "medium", "hard", "expert"]

lookupMimiHeader :: String -> String -> Maybe String
lookupMimiHeader key content =
    case [v | l <- takeWhile (not . null . safeTrim) (lines content),
              Just (k, v) <- [parseHeader l], k == key] of
        (v:_) -> Just v
        []    -> Nothing

parseMimiDifficulty :: String -> Int
parseMimiDifficulty content =
    case lookupMimiHeader "difficulty" content of
        Just v -> case reads v of
                    [(n, "")] -> n
                    _         -> 0
        Nothing -> 0

parseMimiNumber :: String -> Maybe Double
parseMimiNumber s = case reads (safeTrim s) of
    [(n, "")] -> Just n
    _         -> Nothing

jsonNumber :: Double -> String
jsonNumber d
    | d == fromIntegral n = show n
    | otherwise           = show d
  where n = round d :: Int

jsonMaybeNumber :: Maybe Double -> String
jsonMaybeNumber = maybe "null" jsonNumber

parseMimiBpm :: String -> Maybe String
parseMimiBpm content = jsonNumber <$> (lookupMimiHeader "bpm" content >>= parseMimiNumber)

parseMimiAr :: String -> Maybe Double
parseMimiAr content =
    case lookupMimiHeader "ar" content <|> lookupMimiHeader "approach_rate" content of
        Just v -> parseMimiNumber v
        Nothing -> Nothing

infixl 3 <|>
(<|>) :: Maybe a -> Maybe a -> Maybe a
Just x  <|> _ = Just x
Nothing <|> y = y

data ChartStats = ChartStats
    { csLevel       :: Int
    , csAr          :: Maybe Double
    , csMapper      :: String
    , csNoteCount   :: Int
    , csCutCount    :: Int
    , csFlowCount   :: Int
    , csLyricCount  :: Int
    , csFirstMs     :: Maybe Double
    , csLastMs      :: Maybe Double
    }

data NoteRow = NoteRow
    { nrKind :: String
    , nrTime :: Maybe Double
    }

parseChartStats :: String -> ChartStats
parseChartStats content =
    let ls        = lines content
        hLines    = takeWhile (not . null . safeTrim) ls
        rest      = dropWhile (null . safeTrim) (drop (length hLines) ls)
        noteRows  = mapMaybe parseNoteRow $ filter isDataLine rest
        times     = mapMaybe nrTime noteRows
        countKind k = length [() | row <- noteRows, nrKind row == k]
    in ChartStats
        { csLevel       = parseMimiDifficulty content
        , csAr          = parseMimiAr content
        , csMapper      = fromMaybe "" (lookupMimiHeader "mapper" content)
        , csNoteCount   = length noteRows
        , csCutCount    = countKind "cut"
        , csFlowCount   = countKind "flow"
        , csLyricCount  = countKind "lyric"
        , csFirstMs     = if null times then Nothing else Just (minimum times)
        , csLastMs      = if null times then Nothing else Just (maximum times)
        }
  where
    isDataLine l = let t = safeTrim l
                   in not (null t) && not ("#" `isPrefixOf` t)

    timeUnit = map toLower $ fromMaybe "beat" (lookupMimiHeader "time_unit" content)
    bpm      = lookupMimiHeader "bpm" content >>= parseMimiNumber
    offset   = lookupMimiHeader "offset" content >>= parseMimiNumber

    toMs t = case timeUnit of
        "ms"   -> Just t
        "beat" -> case (bpm, offset) of
                    (Just b, Just o) -> Just $ o + (t - 1.0) * (60000.0 / b)
                    _                -> Nothing
        _      -> Nothing

    parseNoteRow line =
        case map safeTrim (splitOn ',' line) of
            (k:t:_:_:_:_) ->
                let kind = case map toLower k of
                        "c"      -> "cut"
                        "cut"    -> "cut"
                        "click"  -> "cut"
                        "f"      -> "cut"
                        "flick"  -> "cut"
                        "s"      -> "flow"
                        "flow"   -> "flow"
                        "stream" -> "flow"
                        "l"      -> "lyric"
                        "lyric"  -> "lyric"
                        other    -> other
                in Just $ NoteRow kind (parseMimiNumber t >>= toMs)
            _ -> Nothing

chartDurationMs :: ChartStats -> Maybe Double
chartDurationMs stats = do
    firstMs <- csFirstMs stats
    lastMs  <- csLastMs stats
    return $ max 0 (lastMs - firstMs)

chartDensity :: ChartStats -> Maybe Double
chartDensity stats = do
    duration <- chartDurationMs stats
    if duration <= 0
      then Nothing
      else Just $ fromIntegral (csNoteCount stats) / (duration / 1000.0)

renderDifficulty :: String -> ChartStats -> String
renderDifficulty diffId stats =
    "{"
    ++ "\"id\":\"" ++ diffId ++ "\","
    ++ "\"level\":" ++ show (csLevel stats) ++ ","
    ++ "\"ar\":" ++ jsonMaybeNumber (csAr stats) ++ ","
    ++ "\"mapper\":\"" ++ escapeForJson (csMapper stats) ++ "\","
    ++ "\"noteCount\":" ++ show (csNoteCount stats) ++ ","
    ++ "\"cutCount\":" ++ show (csCutCount stats) ++ ","
    ++ "\"flowCount\":" ++ show (csFlowCount stats) ++ ","
    ++ "\"lyricCount\":" ++ show (csLyricCount stats) ++ ","
    ++ "\"firstNoteMs\":" ++ jsonMaybeNumber (csFirstMs stats) ++ ","
    ++ "\"lastNoteMs\":" ++ jsonMaybeNumber (csLastMs stats) ++ ","
    ++ "\"playableMs\":" ++ jsonMaybeNumber (chartDurationMs stats) ++ ","
    ++ "\"density\":" ++ jsonMaybeNumber (chartDensity stats)
    ++ "}"

buildManifest :: String -> IO String
buildManifest sitePath = do
    let songsDir = "src/songs"
    exists <- doesDirectoryExist songsDir
    if not exists then return "{\"songs\":[]}" else do
        dirs <- listDirectory songsDir
        songDirs <- filterM (doesDirectoryExist . (songsDir </>)) dirs

        entries <- fmap catMaybes $ forM songDirs $ \songId -> do
            let tabPath = "src/tabs/songs" </> songId <.> "md"
            tabExists <- doesFileExist tabPath
            if not tabExists then return Nothing else do
                content <- readFile tabPath
                let fm = parseFrontmatter content
                    titleEn  = lookupFM "song-name" fm
                    titleJp  = lookupFM "song-name-jp" fm
                    authorEn = lookupFM "song-author" fm
                    authorJp = lookupFM "song-author-jp" fm
                    sourceUrl = lookupFM "song-url" fm

                avail <- filterM (\d -> doesFileExist $ songsDir </> songId </> d ++ ".mimi") difficultyIds
                case avail of
                  [] -> return Nothing
                  (firstDiff:_) -> do
                    firstContent <- readFile (songsDir </> songId </> firstDiff ++ ".mimi")
                    let bpmJson = maybe "null" id (parseMimiBpm firstContent)
                    diffs <- forM avail $ \d -> do
                        chart <- readFile (songsDir </> songId </> d ++ ".mimi")
                        return $ renderDifficulty d (parseChartStats chart)
                    let diffsJson = "[" ++ intercalate "," diffs ++ "]"
                    let href = sitePath ++ "/" ++ songId ++ "/"
                    return $ Just $ "{"
                        ++ "\"id\":\"" ++ songId ++ "\","
                        ++ "\"titleEn\":\"" ++ escapeForJson titleEn ++ "\","
                        ++ "\"titleJp\":\"" ++ escapeForJson titleJp ++ "\","
                        ++ "\"authorEn\":\"" ++ escapeForJson authorEn ++ "\","
                        ++ "\"authorJp\":\"" ++ escapeForJson authorJp ++ "\","
                        ++ "\"sourceUrl\":\"" ++ escapeForJson sourceUrl ++ "\","
                        ++ "\"href\":\"" ++ href ++ "\","
                        ++ "\"bpm\":" ++ bpmJson ++ ","
                        ++ "\"difficulties\":" ++ diffsJson
                        ++ "}"

        return $ "{\"songs\":[" ++ intercalate "," entries ++ "]}"

sitemapLocs :: String -> IO [String]
sitemapLocs base = do
    let songsDir = "src/songs"
    exists <- doesDirectoryExist songsDir
    if not exists then return [] else do
        dirs     <- listDirectory songsDir
        songDirs <- filterM (doesDirectoryExist . (songsDir </>)) dirs
        fmap concat $ forM songDirs $ \songId -> do
            let tabPath = "src/tabs/songs" </> songId <.> "md"
            tabExists <- doesFileExist tabPath
            if not tabExists then return [] else do
                avail <- filterM (\d -> doesFileExist $ songsDir </> songId </> d ++ ".mimi") difficultyIds
                return [ base ++ "/" ++ songId ++ "/?d=" ++ d | d <- avail ]

--------------------------------------------------------------------------------

main :: IO ()
main = do
    setLocaleEncoding utf8
    args           <- getArgs
    let (pathArg, remainingArgs) = extractSitePath args
    pathEnv        <- fromMaybe "" <$> lookupEnv "SITE_PATH"
    let sitePath = normalizeSitePath (if null pathArg then pathEnv else pathArg)
    originEnv      <- fromMaybe "" <$> lookupEnv "SITE_ORIGIN"
    let origin = normalizeOrigin originEnv
    host           <- lookupEnv "PREVIEW_HOST"
    let baseCfg = case host of
                    Just h  -> hakyllConfig { previewHost = h }
                    Nothing -> hakyllConfig
        cfg = if null sitePath
                then baseCfg
                else baseCfg { destinationDirectory = "docs" ++ sitePath }
    withArgs remainingArgs $ hakyllWith cfg (rules sitePath origin)

rules :: String -> String -> Rules ()
rules sitePath origin = do
    let baseCtx = constField "path" sitePath <> defaultContext

    match (makePattern templateDir "*") $ compile templateBodyCompiler

    match "static/**" $ do
        route   $ gsubRoute "static/" (const "")
        compile copyFileCompiler

    -- chart files: compile .mimi -> .json
    match "src/songs/**/*.mimi" $ do
        route   $ gsubRoute "src/" (const "") `composeRoutes` setExtension "json"
        compile chartCompiler

    -- story files: compile .story -> .story.json
    match "src/songs/**/*.story" $ do
        route   $ gsubRoute "src/" (const "") `composeRoutes` setExtension "story.json"
        compile storyCompiler

    -- song data (audio, timing json, etc.) — excludes .mimi and .story (matched above)
    match "src/songs/**" $ do
        route   $ gsubRoute "src/" (const "")
        compile copyFileCompiler

    -- track scss
    scssPartialDep <- makePatternDependency "src/scss/_*.scss"
    match "src/scss/_*.scss" $ compile getResourceBody
    rulesExtraDependencies [scssPartialDep] $
        match "src/scss/default.scss" $ do
            route   $ constRoute "css/default.css"
            compile sassCompiler

    -- track ts/tsx module changes so main.ts re-bundles
    tsPartialDep  <- makePatternDependency "src/ts/**/*.ts"
    tsxPartialDep <- makePatternDependency "src/ts/**/*.tsx"
    rulesExtraDependencies [tsPartialDep, tsxPartialDep] $
        match "src/ts/main.ts" $ do
            route   $ constRoute "js/main.js"
            compile tsCompiler

    songsTabDep <- makePatternDependency "src/tabs/songs/*.md"
    songsChartDep <- makePatternDependency "src/songs/**/*.mimi"
    rulesExtraDependencies [songsTabDep, songsChartDep] $
        match "src/tabs/home.md" $ do
            route   $ constRoute "index.html"
            compile $ do
                let tabNames = ["info", "tutorial"]
                tabCtx <- fmap mconcat $ forM tabNames $ \name -> do
                    en <- loadSnapshotBody (fromFilePath $ "src/tabs/" ++ name ++ ".md")     "content"
                    jp <- loadSnapshotBody (fromFilePath $ "src/tabs/" ++ name ++ ".jp.md")  "content"
                    return $ constField (name ++ "-content")     (escapeForAttr en)
                          <> constField (name ++ "-content-jp")  (escapeForAttr jp)
                manifest <- unsafeCompiler $ buildManifest sitePath
                let homeCtx = tabCtx
                           <> constField "songs-manifest" (escapeForAttr manifest)
                           <> baseCtx
                pandocCompiler
                    >>= loadAndApplyTemplate (makeIdentifier templateDir "home.html") homeCtx

    match ("src/tabs/tutorial.md" .||. "src/tabs/info.md") $
        compile $ pandocCompiler >>= saveSnapshot "content"

    match "src/tabs/*.jp.md" $
        compile $ pandocCompiler >>= saveSnapshot "content"

    match "src/tabs/songs/*.md" $ do
        route   $ customRoute $ \ident ->
            let name = takeBaseName (toFilePath ident)
            in name </> "index.html"
        compile $ do
            ident  <- getUnderlying
            let songId = takeBaseName (toFilePath ident)
            (bpm, levels, mappers) <- unsafeCompiler $ do
                let songDir = "src/songs" </> songId
                avail    <- filterM (\d -> doesFileExist $ songDir </> d ++ ".mimi") difficultyIds
                contents <- forM avail $ \d -> (,) d <$> readFile (songDir </> d ++ ".mimi")
                let bpmStr = case contents of
                               []         -> ""
                               ((_, c):_) -> maybe "" id (parseMimiBpm c)
                    levelsJson = "{" ++ intercalate ","
                                   [ "\"" ++ d ++ "\":" ++ show (parseMimiDifficulty c)
                                   | (d, c) <- contents ]
                                 ++ "}"
                    mappersJson = "{" ++ intercalate ","
                                   [ "\"" ++ d ++ "\":\"" ++ escapeForJson (fromMaybe "" (lookupMimiHeader "mapper" c)) ++ "\""
                                   | (d, c) <- contents ]
                                 ++ "}"
                return (bpmStr, levelsJson, mappersJson)
            let songCtx =
                  constField "textalive-token" textaliveToken <>
                  constField "song-chart-dir" (sitePath ++ "/songs/" ++ songId ++ "/") <>
                  constField "song-bpm" bpm <>
                  constField "song-levels" (escapeForAttr levels) <>
                  constField "song-mappers" (escapeForAttr mappers) <>
                  baseCtx
            pandocCompiler
                >>= loadAndApplyTemplate (makeIdentifier templateDir "song.html") songCtx

    create ["sitemap.xml"] $ do
        route idRoute
        compile $ do
            let base = origin ++ sitePath
            locs  <- unsafeCompiler $ sitemapLocs base
            items <- mapM makeItem locs
            let entryCtx   = field "loc" (return . itemBody)
                sitemapCtx = constField "root" (base ++ "/")
                          <> listField "entries" entryCtx (return items)
            makeItem ""
                >>= loadAndApplyTemplate (makeIdentifier templateDir "sitemap.xml") sitemapCtx