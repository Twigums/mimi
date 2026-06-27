module Config
    ( templateDir
    , hakyllConfig
    , textaliveToken
    ) where

import Hakyll (Configuration (..), defaultConfiguration)

templateDir :: FilePath
templateDir = "src/templates/"

hakyllConfig :: Configuration
hakyllConfig = defaultConfiguration
    { destinationDirectory = "docs" }

textaliveToken :: String
textaliveToken = "N6S7A1HvahiwDLUg"