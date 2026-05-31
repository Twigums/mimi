{-# LANGUAGE OverloadedStrings #-}
import Data.List            (dropWhileEnd, intercalate, isPrefixOf)
import Data.Maybe           (catMaybes, fromMaybe)
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

parseMimiDifficulty :: String -> Int
parseMimiDifficulty content =
    case [v | l <- takeWhile (not . null) (lines content),
              Just (k, v) <- [parseHeader l], k == "difficulty"] of
        (v:_) -> case reads v of
                    [(n, "")] -> n
                    _         -> 0
        []    -> 0
  where
    parseHeader line = case break (== ':') line of
        (key, ':':val) -> Just (safeTrim key, safeTrim val)
        _              -> Nothing

parseMimiBpm :: String -> Maybe String
parseMimiBpm content =
    case [v | l <- takeWhile (not . null) (lines content),
              Just (k, v) <- [parseHeader l], k == "bpm"] of
        (v:_) -> Just v
        []    -> Nothing
  where
    parseHeader line = case break (== ':') line of
        (key, ':':val) -> Just (safeTrim key, safeTrim val)
        _              -> Nothing

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

                avail <- filterM (\d -> doesFileExist $ songsDir </> songId </> d ++ ".mimi") difficultyIds
                case avail of
                  [] -> return Nothing
                  (firstDiff:_) -> do
                    firstContent <- readFile (songsDir </> songId </> firstDiff ++ ".mimi")
                    let bpmJson = maybe "null" id (parseMimiBpm firstContent)
                    diffs <- forM avail $ \d -> do
                        level <- fmap parseMimiDifficulty $ readFile (songsDir </> songId </> d ++ ".mimi")
                        return $ "{\"id\":\"" ++ d ++ "\",\"level\":" ++ show level ++ "}"
                    let diffsJson = "[" ++ intercalate "," diffs ++ "]"
                    let href = sitePath ++ "/" ++ songId ++ "/"
                    return $ Just $ "{"
                        ++ "\"id\":\"" ++ songId ++ "\","
                        ++ "\"titleEn\":\"" ++ escapeForJson titleEn ++ "\","
                        ++ "\"titleJp\":\"" ++ escapeForJson titleJp ++ "\","
                        ++ "\"authorEn\":\"" ++ escapeForJson authorEn ++ "\","
                        ++ "\"authorJp\":\"" ++ escapeForJson authorJp ++ "\","
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