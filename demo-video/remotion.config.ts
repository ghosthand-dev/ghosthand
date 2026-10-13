import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
// TODO: drop this once chrome-headless-shell stops crashing on macOS with "icudtl.dat not found in bundle".
Config.setChromeMode('chrome-for-testing')
