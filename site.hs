{-# LANGUAGE OverloadedStrings #-}
import Data.Char            (toLower)
import Data.List            (dropWhileEnd, intercalate, isPrefixOf)
import Data.Maybe           (catMaybes, fromMaybe, mapMaybe)
import System.Directory     (doesDirectoryExist, doesFileExist, listDirectory)
import System.Environment   (getArgs, lookupEnv, withArgs)
import System.FilePath      ((</>), (<.>), takeBaseName)
import Control.Monad        (filterM, forM)

import Hakyll

import ChartCompiler  (chartCompiler)
import StoryCompiler  (storyCompiler)
import Compilers      (sassCompiler, tsCompiler)
import Config        (hakyllConfig, siteRoot, tabPaths, templateDir, textaliveToken)
import Context       (postCtx)


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
    , csNoteCount   :: Int
    , csClickCount  :: Int
    , csStreamCount :: Int
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
        , csNoteCount   = length noteRows
        , csClickCount  = countKind "click"
        , csStreamCount = countKind "stream"
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
                        "c" -> "click"
                        "s" -> "stream"
                        "l" -> "lyric"
                        other -> other
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
    ++ "\"noteCount\":" ++ show (csNoteCount stats) ++ ","
    ++ "\"clickCount\":" ++ show (csClickCount stats) ++ ","
    ++ "\"streamCount\":" ++ show (csStreamCount stats) ++ ","
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
                    mapper   = lookupFM "song-mapper" fm
                    sourceUrl = lookupFM "song-url" fm

                avail <- filterM (\d -> doesFileExist $ songsDir </> songId </> "chart-" ++ d ++ ".mimi") difficultyIds
                case avail of
                  [] -> return Nothing
                  (firstDiff:_) -> do
                    firstContent <- readFile (songsDir </> songId </> "chart-" ++ firstDiff ++ ".mimi")
                    let bpmJson = maybe "null" id (parseMimiBpm firstContent)
                    diffs <- forM avail $ \d -> do
                        chart <- readFile (songsDir </> songId </> "chart-" ++ d ++ ".mimi")
                        return $ renderDifficulty d (parseChartStats chart)
                    let diffsJson = "[" ++ intercalate "," diffs ++ "]"
                    let href = sitePath ++ "/" ++ songId ++ "/"
                    return $ Just $ "{"
                        ++ "\"id\":\"" ++ songId ++ "\","
                        ++ "\"titleEn\":\"" ++ escapeForJson titleEn ++ "\","
                        ++ "\"titleJp\":\"" ++ escapeForJson titleJp ++ "\","
                        ++ "\"authorEn\":\"" ++ escapeForJson authorEn ++ "\","
                        ++ "\"authorJp\":\"" ++ escapeForJson authorJp ++ "\","
                        ++ "\"mapper\":\"" ++ escapeForJson mapper ++ "\","
                        ++ "\"sourceUrl\":\"" ++ escapeForJson sourceUrl ++ "\","
                        ++ "\"href\":\"" ++ href ++ "\","
                        ++ "\"bpm\":" ++ bpmJson ++ ","
                        ++ "\"difficulties\":" ++ diffsJson
                        ++ "}"

        return $ "{\"songs\":[" ++ intercalate "," entries ++ "]}"

--------------------------------------------------------------------------------

main :: IO ()
main = do
    args           <- getArgs
    let (pathArg, remainingArgs) = extractSitePath args
    pathEnv        <- fromMaybe "" <$> lookupEnv "SITE_PATH"
    let sitePath = normalizeSitePath (if null pathArg then pathEnv else pathArg)
    host           <- lookupEnv "PREVIEW_HOST"
    let baseCfg = case host of
                    Just h  -> hakyllConfig { previewHost = h }
                    Nothing -> hakyllConfig
        cfg = if null sitePath
                then baseCfg
                else baseCfg { destinationDirectory = "docs" ++ sitePath }
    withArgs remainingArgs $ hakyllWith cfg (rules sitePath)

rules :: String -> Rules ()
rules sitePath = do
    let baseCtx = constField "path" sitePath <> defaultContext

    match (makePattern templateDir "*") $ compile templateBodyCompiler

    match "static/**" $ do
        route   $ gsubRoute "static/" (const "")
        compile copyFileCompiler

    -- chart files: compile .mimi -> .json
    match "src/songs/**/*.mimi" $ do
        route   $ gsubRoute "src/" (const "") `composeRoutes` setExtension "json"
        compile chartCompiler

    -- story files: compile .story -> .json
    match "src/songs/**/*.story" $ do
        route   $ gsubRoute "src/" (const "") `composeRoutes` setExtension "json"
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
                infoContent      <- loadSnapshotBody (fromFilePath "src/tabs/info.md") "content"
                tutorialContent  <- loadSnapshotBody (fromFilePath "src/tabs/tutorial.md") "content"
                manifest         <- unsafeCompiler $ buildManifest sitePath
                let homeCtx = constField "info-content"      (escapeForAttr infoContent)
                           <> constField "tutorial-content"  (escapeForAttr tutorialContent)
                           <> constField "songs-manifest"    (escapeForAttr manifest)
                           <> baseCtx
                pandocCompiler
                    >>= loadAndApplyTemplate (makeIdentifier templateDir "home.html") homeCtx

    match "src/tabs/tutorial.md" $ do
        compile $ pandocCompiler
            >>= saveSnapshot "content"

    match "src/tabs/info.md" $ do
        compile $ pandocCompiler
            >>= saveSnapshot "content"

    match "src/tabs/songs/*.md" $ do
        route   $ customRoute $ \ident ->
            let name = takeBaseName (toFilePath ident)
            in name </> "index.html"
        compile $ do
            ident  <- getUnderlying
            let songId = takeBaseName (toFilePath ident)
                songCtx =
                  constField "textalive-token" textaliveToken <>
                  constField "song-chart-dir" (sitePath ++ "/songs/" ++ songId ++ "/") <>
                  baseCtx
            pandocCompiler
                >>= loadAndApplyTemplate (makeIdentifier templateDir "song.html") songCtx

    create ["sitemap.xml"] $ do
        route idRoute
        compile $ do
            pages <- loadAll (fromList $ map (makeIdentifier "") tabPaths)
            let sitemapCtx =
                    constField "root" siteRoot <>
                    constField "path" sitePath <>
                    listField "pages" postCtx (return pages)
            makeItem ""
                >>= loadAndApplyTemplate (makeIdentifier templateDir "sitemap.xml") sitemapCtx
