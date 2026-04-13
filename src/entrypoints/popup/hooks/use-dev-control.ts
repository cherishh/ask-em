const DEV_CONTROL_STORAGE_KEY = 'askem-dev-control';

function getPersistedDevControl() {
  return window.localStorage.getItem(DEV_CONTROL_STORAGE_KEY) === 'true';
}

export function useDevControl() {
  const persistedDevControl = getPersistedDevControl();

  if (window.dev_control === true && !persistedDevControl) {
    window.localStorage.setItem(DEV_CONTROL_STORAGE_KEY, 'true');
    return true;
  }

  if (window.dev_control === false && persistedDevControl) {
    window.localStorage.removeItem(DEV_CONTROL_STORAGE_KEY);
    return false;
  }

  return window.dev_control === true || persistedDevControl;
}
