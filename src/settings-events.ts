let _onSettingsChanged: (() => void) | null = null;
export function settingsChangedFn(): (() => void) | null { return _onSettingsChanged; }
export function setOnSettingsChanged(fn: (() => void) | null) { _onSettingsChanged = fn; }
