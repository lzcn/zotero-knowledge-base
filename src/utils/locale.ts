import { config } from "../../package.json";

export { initLocale, getString, getLocaleID };

/**
 * Initialize locale data
 */
function initLocale() {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = {
    current: l10n,
  };
}

export type LocaleService = Localization;

interface StringOptions {
  branch?: string;
  args?: Record<string, string | number | null>;
}

function getString(key: string, options: StringOptions | string = {}): string {
  return _getString(
    key,
    typeof options === "string" ? { branch: options } : options,
  );
}

function _getString(
  localeString: string,
  options: {
    branch?: string | undefined;
    args?: Record<string, string | number | null>;
  } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  const messages = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix, args },
  ]);
  const pattern = messages ? Array.from(messages)[0] : undefined;
  if (!pattern) {
    return localStringWithPrefix;
  }
  if (branch && pattern.attributes) {
    for (const attr of pattern.attributes) {
      if (attr.name === branch) {
        return attr.value;
      }
    }
    return localStringWithPrefix;
  } else {
    return pattern.value || localStringWithPrefix;
  }
}

function getLocaleID(id: string) {
  return `${config.addonRef}-${id}`;
}
