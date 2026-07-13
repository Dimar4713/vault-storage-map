import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { shell as electronShell } from "electron";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

const VIEW_TYPE_STORAGE_MAP = "vault-storage-map-view";
const CACHE_VERSION = 1;
const MAX_CACHED_NODES = 50_000;

type NodeKind = "folder" | "file";
type ViewTab = "summary" | "treemap" | "folders" | "files" | "types" | "recommendations";
type LanguageMode = "auto" | "ru" | "en" | "zh-cn" | "fr" | "de" | "es" | "it" | "tr" | "hi" | "bn" | "ta" | "pt";
type ResolvedLanguage = Exclude<LanguageMode, "auto">;
type ThemeMode = "system" | "light" | "dark";
type TreemapColorMode = "type" | "size" | "depth";
type ExportFormat = "md" | "csv" | "json";

interface StorageNode {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: NodeKind;
  size: number;
  fileCount: number;
  folderCount: number;
  modifiedAt?: number;
  extension?: string;
  children?: StorageNode[];
}

interface CachedStorageNode extends Omit<StorageNode, "absolutePath" | "children"> {
  children?: CachedStorageNode[];
}

interface ExtensionStat {
  extension: string;
  size: number;
  fileCount: number;
}

interface ScanError {
  relativePath: string;
  message: string;
}

interface ScanProgress {
  filesScanned: number;
  foldersScanned: number;
  bytesScanned: number;
  currentPath: string;
}

interface ScanResult {
  root: StorageNode;
  generatedAt: number;
  durationMs: number;
  extensions: ExtensionStat[];
  errors: ScanError[];
}

interface CachedScanResult {
  cacheVersion: number;
  root: CachedStorageNode;
  generatedAt: number;
  durationMs: number;
  extensions: ExtensionStat[];
  errors: ScanError[];
}

interface StoredSummary {
  generatedAt: number;
  totalSize: number;
  fileCount: number;
  folderCount: number;
  largestFilePath: string | null;
  largestFileSize: number;
  folderSizes: Record<string, number>;
}

interface VaultStorageMapSettings {
  language: LanguageMode;
  theme: ThemeMode;
  treemapColorMode: TreemapColorMode;
  includeHidden: boolean;
  includeObsidianConfig: boolean;
  followSymbolicLinks: boolean;
  scanOnViewOpen: boolean;
  cacheLastScan: boolean;
  largeFileThresholdMb: number;
  maxTableRows: number;
  detailsPanelCollapsed: boolean;
  excludePatterns: string;
  lastSummary?: StoredSummary;
  previousSummary?: StoredSummary;
}

interface Recommendation {
  level: "info" | "warning" | "danger";
  icon: string;
  title: string;
  description: string;
  path?: string;
  copyText?: string;
}

interface TreemapRect {
  node: StorageNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

const DEFAULT_SETTINGS: VaultStorageMapSettings = {
  language: "auto",
  theme: "system",
  treemapColorMode: "type",
  includeHidden: true,
  includeObsidianConfig: true,
  followSymbolicLinks: false,
  scanOnViewOpen: false,
  cacheLastScan: true,
  largeFileThresholdMb: 50,
  maxTableRows: 200,
  detailsPanelCollapsed: false,
  excludePatterns: ".git\n.git/**\nnode_modules\nnode_modules/**\n.trash\n.trash/**",
};

const EN_TRANSLATIONS: Record<string, string> = {
  pluginName: "Vault Storage Map",
  subtitle: "Visual storage analytics for Obsidian",
  localReadOnly: "Local-first · Read-only scan · No uploads",
  developedBy: "Developed by AIMETON · Dimar4713",
  scan: "Scan vault",
  rescan: "Rescan",
  scanning: "Scanning…",
  cancel: "Cancel",
  fastScanHint: "Small vaults may finish before you can press Cancel. While this panel is focused, Esc also cancels the scan.",
  breadcrumbLabel: "Folder path",
  breadcrumbHelp: "This navigation trail shows the current folder. Click any segment to return to that level.",
  search: "Search files or folders…",
  allSizes: "All sizes",
  over1mb: "Over 1 MB",
  over10mb: "Over 10 MB",
  over100mb: "Over 100 MB",
  summary: "Summary",
  treemap: "Treemap",
  folders: "Folders",
  files: "Files",
  fileTypes: "File types",
  recommendations: "Recommendations",
  emptyTitle: "See what occupies your vault",
  emptyText: "Scan notes, attachments, plugin data, indexes, and hidden folders. Only file metadata is read; nothing is uploaded or deleted.",
  previousScan: "Previous scan",
  scannedProgress: "Scanned {files} files and {folders} folders",
  starting: "Starting…",
  totalSize: "Total size",
  scanTime: "Scan time",
  obsidianSize: "Obsidian size",
  largestFolder: "Largest folder",
  largestFile: "Largest file",
  changeSinceLast: "Change since last scan",
  noPreviousComparison: "Run another scan to compare storage growth.",
  topFolders: "Largest folders",
  topFiles: "Largest files",
  scannedAt: "Scanned {date}",
  unreadableEntries: "{count} unreadable entries",
  noData: "No data.",
  noMatches: "No items match the current filters.",
  path: "Path",
  size: "Size",
  type: "Type",
  modified: "Modified",
  actions: "Actions",
  percentVault: "% of vault",
  reveal: "Reveal in file explorer",
  copyPath: "Copy absolute path",
  copied: "Copied.",
  open: "Open",
  drillDown: "Open folder in treemap",
  storageByType: "Storage by file type",
  details: "Details",
  showDetails: "Show details",
  hideDetails: "Hide details",
  selectItem: "Select a block or table row to inspect it.",
  itemKind: "Kind",
  itemFiles: "Files inside",
  itemFolders: "Folders inside",
  shareVault: "Share of vault",
  shareParent: "Share of parent",
  diagnosticOnly: "Recommendations are diagnostic only. The plugin never deletes, moves, or excludes files automatically.",
  noRisks: "No obvious storage risks were detected with the current thresholds.",
  copyRule: "Copy exclusion rule",
  exportMd: "Export Markdown",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  exportCreated: "Report created: {path}",
  exportFailed: "Export failed: {error}",
  scanComplete: "Storage scan complete: {size} across {files} files.",
  scanCancelled: "Storage scan cancelled.",
  scanFailed: "Storage scan failed: {error}",
  desktopRequired: "Vault Storage Map requires a desktop vault with a local file-system path.",
  cachedResult: "Showing cached scan from {date}",
  cacheSkipped: "The scan is too large to cache safely; live results remain available.",
  cacheCleared: "Cached scan cleared.",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  languageAuto: "Automatic",
  languageRussian: "Русский",
  languageEnglish: "English",
  languageChinese: "简体中文",
  colorType: "By file type",
  colorSize: "By size",
  colorDepth: "By depth",
  settingsTitle: "Vault Storage Map",
  languageSetting: "Interface language",
  languageDesc: "Automatic follows the Obsidian or operating-system language.",
  themeSetting: "Interface theme",
  themeDesc: "System follows Obsidian. Light and dark override the plugin panel only.",
  colorSetting: "Treemap colors",
  colorDesc: "Choose whether color represents file type, relative size, or folder depth.",
  includeHidden: "Include hidden files and folders",
  includeHiddenDesc: "Includes names beginning with a dot. Recommended for storage diagnostics.",
  includeObsidian: "Include Obsidian",
  includeObsidianDesc: "Scan plugin data, indexes, caches, and configuration files.",
  scanOnOpen: "Scan when the view opens",
  scanOnOpenDesc: "Disabled by default to avoid unnecessary disk activity.",
  cacheLast: "Cache the last scan",
  cacheLastDesc: "Shows the previous result instantly. Only paths, sizes, dates, and counts are stored locally.",
  followLinks: "Follow symbolic links",
  followLinksDesc: "Keep disabled unless you understand the risk of scanning outside the vault or creating loops.",
  largeThreshold: "Large file threshold",
  largeThresholdDesc: "Files at or above this size are highlighted, in megabytes.",
  maxRows: "Maximum table rows",
  maxRowsDesc: "Limits the number of folders and files rendered in tables.",
  exclusions: "Exclude patterns",
  exclusionsDesc: "One simple glob pattern per line, matched against vault-relative paths.",
  clearCurrent: "Clear current result",
  clearCurrentDesc: "Clears the visualization in memory. No vault files are removed.",
  clearCache: "Clear cached result",
  clearCacheDesc: "Deletes only the plugin's local metadata cache.",
  clear: "Clear",
  folder: "Folder",
  file: "File",
  helpTreemap: "Click to select. Double-click a folder to drill down or a file to open it. Right-click reveals it in Explorer.",
  largeFilesTitle: "{count} large file(s) detected",
  largeFilesDesc: "The largest is {path} at {size}. Review large media, exports, and generated indexes before syncing them.",
  obsidianTitle: "Obsidian occupies {percent} of the vault",
  obsidianDesc: "Plugin data and indexes use {size}. Open the folder ranking to identify the responsible plugin or cache.",
  copilotTitle: "Copilot index files use {size}",
  copilotDesc: "These are derived local indexes. Consider partitioning them and excluding them from third-party synchronization.",
  attachmentsTitle: "Attachments dominate vault storage",
  attachmentsDesc: "{path} uses {size} ({percent}). Consider compression, archival, or selective sync.",
  unreadableTitle: "{count} entries could not be read",
  unreadableDesc: "Totals may be incomplete because of permissions, transient locks, broken links, or unavailable cloud files.",
  about: "About",
  version: "Version {version}",
  openStorageMap: "Open storage map",
  scanVaultStorage: "Scan vault storage",
  languageFrench: "Français",
  languageGerman: "Deutsch",
  languageSpanish: "Español",
  languageItalian: "Italiano",
  languageTurkish: "Türkçe",
  languageHindi: "हिन्दी",
  languageBengali: "বাংলা",
  languageTamil: "தமிழ்",
  languagePortuguese: "Português",
};

const I18N: Record<ResolvedLanguage, Record<string, string>> = {
  en: EN_TRANSLATIONS,
  ru: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Визуальный анализ пространства Obsidian",
    localReadOnly: "Локально · Сканирование только для чтения · Без отправки данных",
    developedBy: "Разработка AIMETON · Dimar4713",
    scan: "Сканировать хранилище",
    rescan: "Сканировать снова",
    scanning: "Сканирование…",
    cancel: "Отмена",
    fastScanHint: "Небольшое хранилище может отсканироваться раньше, чем вы нажмёте «Отмена». Когда панель активна, сканирование также отменяется клавишей Esc.",
    breadcrumbLabel: "Путь по папкам",
    breadcrumbHelp: "Эта навигационная цепочка показывает текущую папку. Нажмите на любой сегмент, чтобы вернуться на выбранный уровень.",
    search: "Поиск файлов и папок…",
    allSizes: "Любой размер",
    over1mb: "Больше 1 МБ",
    over10mb: "Больше 10 МБ",
    over100mb: "Больше 100 МБ",
    summary: "Обзор",
    treemap: "Карта",
    folders: "Папки",
    files: "Файлы",
    fileTypes: "Типы файлов",
    recommendations: "Рекомендации",
    emptyTitle: "Узнайте, что занимает место в хранилище",
    emptyText: "Анализируйте заметки, вложения, данные плагинов, индексы и скрытые папки. Читаются только метаданные файлов; ничего не отправляется и не удаляется.",
    previousScan: "Предыдущее сканирование",
    scannedProgress: "Обработано файлов: {files}, папок: {folders}",
    starting: "Запуск…",
    totalSize: "Общий размер",
    scanTime: "Время анализа",
    obsidianSize: "Размер Obsidian",
    largestFolder: "Самая тяжёлая папка",
    largestFile: "Самый тяжёлый файл",
    changeSinceLast: "Изменение с прошлого анализа",
    noPreviousComparison: "Запустите повторное сканирование, чтобы увидеть изменение размера.",
    topFolders: "Самые тяжёлые папки",
    topFiles: "Самые тяжёлые файлы",
    scannedAt: "Сканирование: {date}",
    unreadableEntries: "Не удалось прочитать: {count}",
    noData: "Нет данных.",
    noMatches: "По текущим фильтрам ничего не найдено.",
    path: "Путь",
    size: "Размер",
    type: "Тип",
    modified: "Изменён",
    actions: "Действия",
    percentVault: "% хранилища",
    reveal: "Показать в Проводнике",
    copyPath: "Копировать полный путь",
    copied: "Скопировано.",
    open: "Открыть",
    drillDown: "Открыть папку на карте",
    storageByType: "Размер по типам файлов",
    details: "Подробности",
    showDetails: "Показать подробности",
    hideDetails: "Скрыть подробности",
    selectItem: "Выберите блок карты или строку таблицы.",
    itemKind: "Объект",
    itemFiles: "Файлов внутри",
    itemFolders: "Папок внутри",
    shareVault: "Доля хранилища",
    shareParent: "Доля родительской папки",
    diagnosticOnly: "Рекомендации носят диагностический характер. Плагин ничего не удаляет, не перемещает и не исключает автоматически.",
    noRisks: "При текущих порогах явных проблем с пространством не обнаружено.",
    copyRule: "Копировать правило исключения",
    exportMd: "Экспорт Markdown",
    exportCsv: "Экспорт CSV",
    exportJson: "Экспорт JSON",
    exportCreated: "Отчёт создан: {path}",
    exportFailed: "Ошибка экспорта: {error}",
    scanComplete: "Сканирование завершено: {size}, файлов: {files}.",
    scanCancelled: "Сканирование отменено.",
    scanFailed: "Ошибка сканирования: {error}",
    desktopRequired: "Vault Storage Map требует настольную версию и локальный путь к хранилищу.",
    cachedResult: "Показан кэш анализа от {date}",
    cacheSkipped: "Результат слишком большой для безопасного кэширования; текущая визуализация доступна.",
    cacheCleared: "Кэш анализа очищен.",
    themeSystem: "Системная",
    themeLight: "Светлая",
    themeDark: "Тёмная",
    languageAuto: "Автоматически",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    colorType: "По типу файла",
    colorSize: "По размеру",
    colorDepth: "По глубине",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Язык интерфейса",
    languageDesc: "Автоматический режим следует языку Obsidian или операционной системы.",
    themeSetting: "Тема интерфейса",
    themeDesc: "Системная следует Obsidian. Светлая и тёмная применяются только к панели плагина.",
    colorSetting: "Цвета карты",
    colorDesc: "Цвет может обозначать тип файла, относительный размер или глубину папки.",
    includeHidden: "Учитывать скрытые файлы и папки",
    includeHiddenDesc: "Включает имена, начинающиеся с точки. Рекомендуется для диагностики.",
    includeObsidian: "Учитывать Obsidian",
    includeObsidianDesc: "Анализировать данные плагинов, индексы, кэши и конфигурацию.",
    scanOnOpen: "Сканировать при открытии панели",
    scanOnOpenDesc: "По умолчанию выключено, чтобы не создавать лишнюю нагрузку на диск.",
    cacheLast: "Кэшировать последний анализ",
    cacheLastDesc: "Предыдущий результат показывается сразу. Локально сохраняются только пути, размеры, даты и счётчики.",
    followLinks: "Переходить по символическим ссылкам",
    followLinksDesc: "Оставьте выключенным, если не понимаете риск выхода за пределы хранилища или циклических ссылок.",
    largeThreshold: "Порог крупного файла",
    largeThresholdDesc: "Файлы не меньше указанного размера выделяются в рекомендациях, в мегабайтах.",
    maxRows: "Максимум строк таблицы",
    maxRowsDesc: "Ограничивает количество отображаемых папок и файлов.",
    exclusions: "Исключения",
    exclusionsDesc: "Один простой glob-шаблон на строку для относительных путей хранилища.",
    clearCurrent: "Очистить текущий результат",
    clearCurrentDesc: "Убирает визуализацию из памяти. Файлы хранилища не затрагиваются.",
    clearCache: "Очистить кэш анализа",
    clearCacheDesc: "Удаляет только локальный кэш метаданных этого плагина.",
    clear: "Очистить",
    folder: "Папка",
    file: "Файл",
    helpTreemap: "Клик — выбрать. Двойной клик по папке — перейти внутрь, по файлу — открыть. Правый клик показывает объект в Проводнике.",
    largeFilesTitle: "Обнаружено крупных файлов: {count}",
    largeFilesDesc: "Самый большой: {path}, размер {size}. Проверьте медиа, экспорты и генерируемые индексы перед синхронизацией.",
    obsidianTitle: "Obsidian занимает {percent} хранилища",
    obsidianDesc: "Данные плагинов и индексы занимают {size}. Откройте рейтинг папок, чтобы найти источник роста.",
    copilotTitle: "Индексы Copilot занимают {size}",
    copilotDesc: "Это производные локальные индексы. Можно разбить их на части и исключить из сторонней синхронизации.",
    attachmentsTitle: "Вложения занимают основную часть хранилища",
    attachmentsDesc: "{path} занимает {size} ({percent}). Рассмотрите сжатие, архивирование или выборочную синхронизацию.",
    unreadableTitle: "Не удалось прочитать объектов: {count}",
    unreadableDesc: "Итоги могут быть неполными из-за прав доступа, блокировок, повреждённых ссылок или недоступных облачных файлов.",
    about: "О плагине",
    version: "Версия {version}",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
    openStorageMap: "Открыть карту пространства",
    scanVaultStorage: "Сканировать пространство хранилища",

  },
  "zh-cn": {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Obsidian 存储空间可视化分析",
    localReadOnly: "本地优先 · 只读扫描 · 不上传数据",
    developedBy: "AIMETON · Dimar4713 开发",
    scan: "扫描仓库",
    rescan: "重新扫描",
    scanning: "正在扫描…",
    cancel: "取消",
    fastScanHint: "较小的仓库可能会在您点击“取消”之前完成扫描。当此面板处于活动状态时，也可以按 Esc 取消扫描。",
    breadcrumbLabel: "文件夹路径",
    breadcrumbHelp: "此导航路径显示当前文件夹。点击任意层级可返回该位置。",
    search: "搜索文件或文件夹…",
    allSizes: "全部大小",
    over1mb: "大于 1 MB",
    over10mb: "大于 10 MB",
    over100mb: "大于 100 MB",
    summary: "概览",
    treemap: "矩形树图",
    folders: "文件夹",
    files: "文件",
    fileTypes: "文件类型",
    recommendations: "建议",
    emptyTitle: "查看仓库空间占用情况",
    emptyText: "扫描笔记、附件、插件数据、索引和隐藏文件夹。仅读取文件元数据，不上传或删除任何内容。",
    previousScan: "上次扫描",
    scannedProgress: "已扫描 {files} 个文件和 {folders} 个文件夹",
    starting: "正在启动…",
    totalSize: "总大小",
    scanTime: "扫描时间",
    obsidianSize: "Obsidian 大小",
    largestFolder: "最大文件夹",
    largestFile: "最大文件",
    changeSinceLast: "与上次扫描相比",
    noPreviousComparison: "再次扫描后可查看空间变化。",
    topFolders: "最大的文件夹",
    topFiles: "最大的文件",
    scannedAt: "扫描时间：{date}",
    unreadableEntries: "无法读取：{count}",
    noData: "没有数据。",
    noMatches: "当前筛选条件下没有结果。",
    path: "路径",
    size: "大小",
    type: "类型",
    modified: "修改时间",
    actions: "操作",
    percentVault: "仓库占比",
    reveal: "在资源管理器中显示",
    copyPath: "复制完整路径",
    copied: "已复制。",
    open: "打开",
    drillDown: "在树图中打开文件夹",
    storageByType: "按文件类型统计",
    details: "详细信息",
    showDetails: "显示详细信息",
    hideDetails: "隐藏详细信息",
    selectItem: "选择树图块或表格行以查看详情。",
    itemKind: "对象类型",
    itemFiles: "包含文件",
    itemFolders: "包含文件夹",
    shareVault: "仓库占比",
    shareParent: "父文件夹占比",
    diagnosticOnly: "建议仅用于诊断。插件不会自动删除、移动或排除文件。",
    noRisks: "按当前阈值未发现明显的存储风险。",
    copyRule: "复制排除规则",
    exportMd: "导出 Markdown",
    exportCsv: "导出 CSV",
    exportJson: "导出 JSON",
    exportCreated: "报告已创建：{path}",
    exportFailed: "导出失败：{error}",
    scanComplete: "扫描完成：{size}，共 {files} 个文件。",
    scanCancelled: "扫描已取消。",
    scanFailed: "扫描失败：{error}",
    desktopRequired: "Vault Storage Map 需要桌面版和本地文件系统路径。",
    cachedResult: "正在显示 {date} 的缓存扫描结果",
    cacheSkipped: "扫描结果过大，未安全缓存；当前结果仍可使用。",
    cacheCleared: "扫描缓存已清除。",
    themeSystem: "系统",
    themeLight: "浅色",
    themeDark: "深色",
    languageAuto: "自动",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    colorType: "按文件类型",
    colorSize: "按大小",
    colorDepth: "按层级",
    settingsTitle: "Vault Storage Map",
    languageSetting: "界面语言",
    languageDesc: "自动模式跟随 Obsidian 或操作系统语言。",
    themeSetting: "界面主题",
    themeDesc: "系统模式跟随 Obsidian；浅色和深色仅覆盖插件面板。",
    colorSetting: "树图颜色",
    colorDesc: "颜色可表示文件类型、相对大小或文件夹层级。",
    includeHidden: "包含隐藏文件和文件夹",
    includeHiddenDesc: "包含以点开头的名称，建议用于存储诊断。",
    includeObsidian: "包含 Obsidian",
    includeObsidianDesc: "扫描插件数据、索引、缓存和配置文件。",
    scanOnOpen: "打开面板时扫描",
    scanOnOpenDesc: "默认关闭，以避免不必要的磁盘活动。",
    cacheLast: "缓存上次扫描",
    cacheLastDesc: "立即显示上次结果。本地仅保存路径、大小、日期和计数。",
    followLinks: "跟随符号链接",
    followLinksDesc: "除非了解扫描到仓库外部或形成循环的风险，否则请保持关闭。",
    largeThreshold: "大文件阈值",
    largeThresholdDesc: "达到此大小的文件会在建议中突出显示，单位为 MB。",
    maxRows: "表格最大行数",
    maxRowsDesc: "限制表格中显示的文件夹和文件数量。",
    exclusions: "排除规则",
    exclusionsDesc: "每行一个简单 glob 模式，匹配仓库相对路径。",
    clearCurrent: "清除当前结果",
    clearCurrentDesc: "清除内存中的可视化，不会删除仓库文件。",
    clearCache: "清除扫描缓存",
    clearCacheDesc: "仅删除插件本地的元数据缓存。",
    clear: "清除",
    folder: "文件夹",
    file: "文件",
    helpTreemap: "单击选择；双击文件夹进入，双击文件打开；右键在资源管理器中显示。",
    largeFilesTitle: "检测到 {count} 个大文件",
    largeFilesDesc: "最大的是 {path}，大小 {size}。同步前请检查大型媒体、导出文件和生成的索引。",
    obsidianTitle: "Obsidian 占仓库的 {percent}",
    obsidianDesc: "插件数据和索引占用 {size}。请查看文件夹排名以定位相关插件或缓存。",
    copilotTitle: "Copilot 索引占用 {size}",
    copilotDesc: "这些是可重新生成的本地索引。可考虑分区并从第三方同步中排除。",
    attachmentsTitle: "附件占据主要存储空间",
    attachmentsDesc: "{path} 占用 {size}（{percent}）。可考虑压缩、归档或选择性同步。",
    unreadableTitle: "有 {count} 个项目无法读取",
    unreadableDesc: "由于权限、临时锁定、损坏链接或不可用的云文件，统计可能不完整。",
    about: "关于",
    version: "版本 {version}",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
    openStorageMap: "打开存储地图",
    scanVaultStorage: "扫描库的存储空间",

  },
  fr: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Analyse visuelle de l’espace de stockage",
    localReadOnly: "Local · Analyse en lecture seule · Aucun envoi",
    developedBy: "Développé par AIMETON · Dimar4713",
    scan: "Analyser le coffre",
    rescan: "Analyser à nouveau",
    scanning: "Analyse…",
    cancel: "Annuler",
    fastScanHint: "Les petits coffres peuvent être analysés avant que vous puissiez appuyer sur Annuler. Lorsque ce panneau est actif, Échap annule également l’analyse.",
    breadcrumbLabel: "Chemin des dossiers",
    breadcrumbHelp: "Ce fil de navigation indique le dossier actuel. Cliquez sur un segment pour revenir à ce niveau.",
    search: "Rechercher des fichiers ou dossiers…",
    allSizes: "Toutes les tailles",
    over1mb: "Plus de 1 Mo",
    over10mb: "Plus de 10 Mo",
    over100mb: "Plus de 100 Mo",
    summary: "Vue d’ensemble",
    treemap: "Carte",
    folders: "Dossiers",
    files: "Fichiers",
    fileTypes: "Types de fichiers",
    recommendations: "Recommandations",
    emptyTitle: "Découvrez ce qui occupe votre coffre",
    emptyText: "Analysez les notes, pièces jointes, données de modules, index et dossiers cachés. Seules les métadonnées sont lues ; rien n’est envoyé ni supprimé.",
    previousScan: "Analyse précédente",
    scannedProgress: "{files} fichiers et {folders} dossiers analysés",
    starting: "Démarrage…",
    totalSize: "Taille totale",
    scanTime: "Durée de l’analyse",
    obsidianSize: "Taille de Obsidian",
    largestFolder: "Dossier le plus volumineux",
    largestFile: "Fichier le plus volumineux",
    changeSinceLast: "Évolution depuis la dernière analyse",
    noPreviousComparison: "Lancez une nouvelle analyse pour comparer l’évolution du stockage.",
    topFolders: "Dossiers les plus volumineux",
    topFiles: "Fichiers les plus volumineux",
    scannedAt: "Analysé le {date}",
    unreadableEntries: "{count} éléments illisibles",
    noData: "Aucune donnée.",
    noMatches: "Aucun élément ne correspond aux filtres actuels.",
    path: "Chemin",
    size: "Taille",
    type: "Type",
    modified: "Modifié",
    actions: "Actions",
    percentVault: "% du coffre",
    reveal: "Afficher dans l’explorateur de fichiers",
    copyPath: "Copier le chemin absolu",
    copied: "Copié.",
    open: "Ouvrir",
    drillDown: "Ouvrir le dossier dans la carte",
    storageByType: "Stockage par type de fichier",
    details: "Détails",
    showDetails: "Afficher les détails",
    hideDetails: "Masquer les détails",
    selectItem: "Sélectionnez un bloc de la carte ou une ligne du tableau.",
    itemKind: "Nature",
    itemFiles: "Fichiers contenus",
    itemFolders: "Dossiers contenus",
    shareVault: "Part du coffre",
    shareParent: "Part du dossier parent",
    diagnosticOnly: "Les recommandations sont uniquement diagnostiques. Le module ne supprime, ne déplace et n’exclut jamais automatiquement des fichiers.",
    noRisks: "Aucun risque évident de stockage détecté avec les seuils actuels.",
    copyRule: "Copier la règle d’exclusion",
    exportMd: "Exporter en Markdown",
    exportCsv: "Exporter en CSV",
    exportJson: "Exporter en JSON",
    exportCreated: "Rapport créé : {path}",
    exportFailed: "Échec de l’export : {error}",
    scanComplete: "Analyse terminée : {size} dans {files} fichiers.",
    scanCancelled: "Analyse annulée.",
    scanFailed: "Échec de l’analyse : {error}",
    desktopRequired: "Vault Storage Map nécessite la version de bureau et un chemin local vers le coffre.",
    cachedResult: "Affichage de l’analyse en cache du {date}",
    cacheSkipped: "L’analyse est trop volumineuse pour être mise en cache en toute sécurité ; les résultats restent disponibles.",
    cacheCleared: "Cache de l’analyse effacé.",
    themeSystem: "Système",
    themeLight: "Clair",
    themeDark: "Sombre",
    languageAuto: "Automatique",
    colorType: "Par type de fichier",
    colorSize: "Par taille",
    colorDepth: "Par profondeur",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Langue de l’interface",
    languageDesc: "Le mode automatique suit la langue d’Obsidian ou du système.",
    themeSetting: "Thème de l’interface",
    themeDesc: "Système suit Obsidian. Clair et sombre s’appliquent uniquement au panneau du module.",
    colorSetting: "Couleurs de la carte",
    colorDesc: "Choisissez si la couleur représente le type, la taille relative ou la profondeur du dossier.",
    includeHidden: "Inclure les fichiers et dossiers cachés",
    includeHiddenDesc: "Inclut les noms commençant par un point. Recommandé pour le diagnostic du stockage.",
    includeObsidian: "Inclure Obsidian",
    includeObsidianDesc: "Analyse les données des modules, index, caches et fichiers de configuration.",
    scanOnOpen: "Analyser à l’ouverture de la vue",
    scanOnOpenDesc: "Désactivé par défaut pour éviter une activité disque inutile.",
    cacheLast: "Mettre en cache la dernière analyse",
    cacheLastDesc: "Affiche immédiatement le résultat précédent. Seuls chemins, tailles, dates et compteurs sont stockés localement.",
    followLinks: "Suivre les liens symboliques",
    followLinksDesc: "Laissez désactivé sauf si vous comprenez le risque d’analyser hors du coffre ou de créer des boucles.",
    largeThreshold: "Seuil de fichier volumineux",
    largeThresholdDesc: "Les fichiers de cette taille ou plus sont mis en évidence, en mégaoctets.",
    maxRows: "Nombre maximal de lignes",
    maxRowsDesc: "Limite le nombre de dossiers et fichiers affichés dans les tableaux.",
    exclusions: "Motifs d’exclusion",
    exclusionsDesc: "Un motif glob simple par ligne, appliqué aux chemins relatifs au coffre.",
    clearCurrent: "Effacer le résultat actuel",
    clearCurrentDesc: "Efface la visualisation en mémoire. Aucun fichier du coffre n’est supprimé.",
    clearCache: "Effacer le résultat en cache",
    clearCacheDesc: "Supprime uniquement le cache local de métadonnées du module.",
    clear: "Effacer",
    folder: "Dossier",
    file: "Fichier",
    helpTreemap: "Cliquez pour sélectionner. Double-cliquez sur un dossier pour l’ouvrir ou sur un fichier pour l’ouvrir. Un clic droit l’affiche dans l’explorateur.",
    largeFilesTitle: "{count} fichier(s) volumineux détecté(s)",
    largeFilesDesc: "Le plus volumineux est {path} ({size}). Vérifiez les médias, exports et index générés avant synchronisation.",
    obsidianTitle: "Obsidian occupe {percent} du coffre",
    obsidianDesc: "Les données de modules et index utilisent {size}. Consultez le classement des dossiers pour identifier le module ou cache responsable.",
    copilotTitle: "Les index Copilot utilisent {size}",
    copilotDesc: "Ce sont des index locaux dérivés. Envisagez de les partitionner et de les exclure des synchronisations tierces.",
    attachmentsTitle: "Les pièces jointes dominent le stockage",
    attachmentsDesc: "{path} utilise {size} ({percent}). Envisagez compression, archivage ou synchronisation sélective.",
    unreadableTitle: "{count} éléments n’ont pas pu être lus",
    unreadableDesc: "Les totaux peuvent être incomplets à cause des autorisations, verrous temporaires, liens cassés ou fichiers cloud indisponibles.",
    about: "À propos",
    version: "Version {version}",
    openStorageMap: "Ouvrir la carte de stockage",
    scanVaultStorage: "Analyser le stockage du coffre",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  de: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Visuelle Speicheranalyse",
    localReadOnly: "Lokal · Schreibgeschützter Scan · Keine Uploads",
    developedBy: "Entwickelt von AIMETON · Dimar4713",
    scan: "Vault scannen",
    rescan: "Erneut scannen",
    scanning: "Scan läuft…",
    cancel: "Abbrechen",
    fastScanHint: "Kleine Vaults können fertig sein, bevor Sie Abbrechen drücken können. Wenn dieses Fenster aktiv ist, beendet Esc den Scan ebenfalls.",
    breadcrumbLabel: "Ordnerpfad",
    breadcrumbHelp: "Diese Navigationsleiste zeigt den aktuellen Ordner. Klicken Sie auf ein Segment, um zu dieser Ebene zurückzukehren.",
    search: "Dateien oder Ordner suchen…",
    allSizes: "Alle Größen",
    over1mb: "Über 1 MB",
    over10mb: "Über 10 MB",
    over100mb: "Über 100 MB",
    summary: "Übersicht",
    treemap: "Karte",
    folders: "Ordner",
    files: "Dateien",
    fileTypes: "Dateitypen",
    recommendations: "Empfehlungen",
    emptyTitle: "Sehen Sie, was Ihren Vault belegt",
    emptyText: "Scannen Sie Notizen, Anhänge, Plugin-Daten, Indizes und versteckte Ordner. Es werden nur Metadaten gelesen; nichts wird hochgeladen oder gelöscht.",
    previousScan: "Vorheriger Scan",
    scannedProgress: "{files} Dateien und {folders} Ordner gescannt",
    starting: "Start…",
    totalSize: "Gesamtgröße",
    scanTime: "Scandauer",
    obsidianSize: "Größe von Obsidian",
    largestFolder: "Größter Ordner",
    largestFile: "Größte Datei",
    changeSinceLast: "Änderung seit dem letzten Scan",
    noPreviousComparison: "Führen Sie einen weiteren Scan aus, um das Speicherwachstum zu vergleichen.",
    topFolders: "Größte Ordner",
    topFiles: "Größte Dateien",
    scannedAt: "Gescannt am {date}",
    unreadableEntries: "{count} nicht lesbare Einträge",
    noData: "Keine Daten.",
    noMatches: "Keine Elemente entsprechen den aktuellen Filtern.",
    path: "Pfad",
    size: "Größe",
    type: "Typ",
    modified: "Geändert",
    actions: "Aktionen",
    percentVault: "% des Vaults",
    reveal: "Im Datei-Explorer anzeigen",
    copyPath: "Absoluten Pfad kopieren",
    copied: "Kopiert.",
    open: "Öffnen",
    drillDown: "Ordner in der Karte öffnen",
    storageByType: "Speicher nach Dateityp",
    details: "Details",
    showDetails: "Details anzeigen",
    hideDetails: "Details ausblenden",
    selectItem: "Wählen Sie einen Kartenblock oder eine Tabellenzeile aus.",
    itemKind: "Art",
    itemFiles: "Enthaltene Dateien",
    itemFolders: "Enthaltene Ordner",
    shareVault: "Anteil am Vault",
    shareParent: "Anteil am übergeordneten Ordner",
    diagnosticOnly: "Empfehlungen dienen nur der Diagnose. Das Plugin löscht, verschiebt oder schließt Dateien niemals automatisch aus.",
    noRisks: "Mit den aktuellen Schwellenwerten wurden keine offensichtlichen Speicherrisiken erkannt.",
    copyRule: "Ausschlussregel kopieren",
    exportMd: "Markdown exportieren",
    exportCsv: "CSV exportieren",
    exportJson: "JSON exportieren",
    exportCreated: "Bericht erstellt: {path}",
    exportFailed: "Export fehlgeschlagen: {error}",
    scanComplete: "Speicherscan abgeschlossen: {size} in {files} Dateien.",
    scanCancelled: "Speicherscan abgebrochen.",
    scanFailed: "Speicherscan fehlgeschlagen: {error}",
    desktopRequired: "Vault Storage Map benötigt die Desktop-Version und einen lokalen Vault-Pfad.",
    cachedResult: "Zwischengespeicherter Scan vom {date}",
    cacheSkipped: "Der Scan ist zu groß für eine sichere Zwischenspeicherung; die Live-Ergebnisse bleiben verfügbar.",
    cacheCleared: "Zwischengespeicherter Scan gelöscht.",
    themeSystem: "System",
    themeLight: "Hell",
    themeDark: "Dunkel",
    languageAuto: "Automatisch",
    colorType: "Nach Dateityp",
    colorSize: "Nach Größe",
    colorDepth: "Nach Tiefe",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Oberflächensprache",
    languageDesc: "Automatisch folgt der Sprache von Obsidian oder des Betriebssystems.",
    themeSetting: "Oberflächenthema",
    themeDesc: "System folgt Obsidian. Hell und Dunkel gelten nur für das Plugin-Fenster.",
    colorSetting: "Kartenfarben",
    colorDesc: "Wählen Sie, ob die Farbe Dateityp, relative Größe oder Ordnertiefe darstellt.",
    includeHidden: "Versteckte Dateien und Ordner einbeziehen",
    includeHiddenDesc: "Schließt Namen ein, die mit einem Punkt beginnen. Für Speicherdiagnosen empfohlen.",
    includeObsidian: "Obsidian einbeziehen",
    includeObsidianDesc: "Plugin-Daten, Indizes, Caches und Konfigurationsdateien scannen.",
    scanOnOpen: "Beim Öffnen der Ansicht scannen",
    scanOnOpenDesc: "Standardmäßig deaktiviert, um unnötige Festplattenaktivität zu vermeiden.",
    cacheLast: "Letzten Scan zwischenspeichern",
    cacheLastDesc: "Zeigt das vorherige Ergebnis sofort. Nur Pfade, Größen, Daten und Zähler werden lokal gespeichert.",
    followLinks: "Symbolischen Links folgen",
    followLinksDesc: "Deaktiviert lassen, außer Sie verstehen das Risiko, außerhalb des Vaults zu scannen oder Schleifen zu erzeugen.",
    largeThreshold: "Schwellenwert für große Dateien",
    largeThresholdDesc: "Dateien ab dieser Größe werden hervorgehoben, in Megabyte.",
    maxRows: "Maximale Tabellenzeilen",
    maxRowsDesc: "Begrenzt die Anzahl der in Tabellen dargestellten Ordner und Dateien.",
    exclusions: "Ausschlussmuster",
    exclusionsDesc: "Ein einfaches Glob-Muster pro Zeile, angewendet auf Vault-relative Pfade.",
    clearCurrent: "Aktuelles Ergebnis löschen",
    clearCurrentDesc: "Löscht die Visualisierung im Speicher. Keine Vault-Dateien werden entfernt.",
    clearCache: "Zwischengespeichertes Ergebnis löschen",
    clearCacheDesc: "Löscht nur den lokalen Metadaten-Cache des Plugins.",
    clear: "Löschen",
    folder: "Ordner",
    file: "Datei",
    helpTreemap: "Klicken zum Auswählen. Doppelklicken Sie auf einen Ordner zum Öffnen oder auf eine Datei zum Öffnen. Rechtsklick zeigt das Element im Explorer.",
    largeFilesTitle: "{count} große Datei(en) erkannt",
    largeFilesDesc: "Die größte ist {path} mit {size}. Prüfen Sie große Medien, Exporte und erzeugte Indizes vor der Synchronisierung.",
    obsidianTitle: "Obsidian belegt {percent} des Vaults",
    obsidianDesc: "Plugin-Daten und Indizes verwenden {size}. Öffnen Sie die Ordner-Rangliste, um das verantwortliche Plugin oder den Cache zu finden.",
    copilotTitle: "Copilot-Indexdateien verwenden {size}",
    copilotDesc: "Dies sind abgeleitete lokale Indizes. Erwägen Sie eine Partitionierung und den Ausschluss von Drittanbieter-Synchronisierungen.",
    attachmentsTitle: "Anhänge dominieren den Vault-Speicher",
    attachmentsDesc: "{path} verwendet {size} ({percent}). Erwägen Sie Komprimierung, Archivierung oder selektive Synchronisierung.",
    unreadableTitle: "{count} Einträge konnten nicht gelesen werden",
    unreadableDesc: "Summen können wegen Berechtigungen, temporären Sperren, defekten Links oder nicht verfügbaren Cloud-Dateien unvollständig sein.",
    about: "Über",
    version: "Version {version}",
    openStorageMap: "Speicherkarte öffnen",
    scanVaultStorage: "Vault-Speicher scannen",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  es: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Análisis visual del almacenamiento",
    localReadOnly: "Local · Análisis de solo lectura · Sin envíos",
    developedBy: "Desarrollado por AIMETON · Dimar4713",
    scan: "Analizar bóveda",
    rescan: "Analizar de nuevo",
    scanning: "Analizando…",
    cancel: "Cancelar",
    fastScanHint: "Las bóvedas pequeñas pueden terminar antes de que pueda pulsar Cancelar. Cuando este panel está enfocado, Esc también cancela el análisis.",
    breadcrumbLabel: "Ruta de carpetas",
    breadcrumbHelp: "Esta ruta de navegación muestra la carpeta actual. Pulse cualquier segmento para volver a ese nivel.",
    search: "Buscar archivos o carpetas…",
    allSizes: "Todos los tamaños",
    over1mb: "Más de 1 MB",
    over10mb: "Más de 10 MB",
    over100mb: "Más de 100 MB",
    summary: "Resumen",
    treemap: "Mapa",
    folders: "Carpetas",
    files: "Archivos",
    fileTypes: "Tipos de archivo",
    recommendations: "Recomendaciones",
    emptyTitle: "Descubra qué ocupa su bóveda",
    emptyText: "Analice notas, adjuntos, datos de complementos, índices y carpetas ocultas. Solo se leen metadatos; nada se envía ni se elimina.",
    previousScan: "Análisis anterior",
    scannedProgress: "Analizados {files} archivos y {folders} carpetas",
    starting: "Iniciando…",
    totalSize: "Tamaño total",
    scanTime: "Tiempo de análisis",
    obsidianSize: "Tamaño de Obsidian",
    largestFolder: "Carpeta más grande",
    largestFile: "Archivo más grande",
    changeSinceLast: "Cambio desde el último análisis",
    noPreviousComparison: "Realice otro análisis para comparar el crecimiento del almacenamiento.",
    topFolders: "Carpetas más grandes",
    topFiles: "Archivos más grandes",
    scannedAt: "Analizado el {date}",
    unreadableEntries: "{count} elementos ilegibles",
    noData: "Sin datos.",
    noMatches: "Ningún elemento coincide con los filtros actuales.",
    path: "Ruta",
    size: "Tamaño",
    type: "Tipo",
    modified: "Modificado",
    actions: "Acciones",
    percentVault: "% de la bóveda",
    reveal: "Mostrar en el explorador de archivos",
    copyPath: "Copiar ruta absoluta",
    copied: "Copiado.",
    open: "Abrir",
    drillDown: "Abrir carpeta en el mapa",
    storageByType: "Almacenamiento por tipo de archivo",
    details: "Detalles",
    showDetails: "Mostrar detalles",
    hideDetails: "Ocultar detalles",
    selectItem: "Seleccione un bloque del mapa o una fila de la tabla.",
    itemKind: "Clase",
    itemFiles: "Archivos dentro",
    itemFolders: "Carpetas dentro",
    shareVault: "Parte de la bóveda",
    shareParent: "Parte de la carpeta superior",
    diagnosticOnly: "Las recomendaciones son solo de diagnóstico. El complemento nunca elimina, mueve ni excluye archivos automáticamente.",
    noRisks: "No se detectaron riesgos evidentes con los umbrales actuales.",
    copyRule: "Copiar regla de exclusión",
    exportMd: "Exportar Markdown",
    exportCsv: "Exportar CSV",
    exportJson: "Exportar JSON",
    exportCreated: "Informe creado: {path}",
    exportFailed: "Error de exportación: {error}",
    scanComplete: "Análisis completado: {size} en {files} archivos.",
    scanCancelled: "Análisis cancelado.",
    scanFailed: "Error de análisis: {error}",
    desktopRequired: "Vault Storage Map requiere la versión de escritorio y una ruta local de la bóveda.",
    cachedResult: "Mostrando análisis en caché del {date}",
    cacheSkipped: "El análisis es demasiado grande para almacenarlo de forma segura; los resultados siguen disponibles.",
    cacheCleared: "Caché del análisis eliminada.",
    themeSystem: "Sistema",
    themeLight: "Claro",
    themeDark: "Oscuro",
    languageAuto: "Automático",
    colorType: "Por tipo de archivo",
    colorSize: "Por tamaño",
    colorDepth: "Por profundidad",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Idioma de la interfaz",
    languageDesc: "Automático sigue el idioma de Obsidian o del sistema operativo.",
    themeSetting: "Tema de la interfaz",
    themeDesc: "Sistema sigue Obsidian. Claro y oscuro solo afectan al panel del complemento.",
    colorSetting: "Colores del mapa",
    colorDesc: "Elija si el color representa el tipo de archivo, el tamaño relativo o la profundidad.",
    includeHidden: "Incluir archivos y carpetas ocultos",
    includeHiddenDesc: "Incluye nombres que comienzan por punto. Recomendado para diagnósticos.",
    includeObsidian: "Incluir Obsidian",
    includeObsidianDesc: "Analiza datos de complementos, índices, cachés y archivos de configuración.",
    scanOnOpen: "Analizar al abrir la vista",
    scanOnOpenDesc: "Desactivado de forma predeterminada para evitar actividad de disco innecesaria.",
    cacheLast: "Guardar el último análisis en caché",
    cacheLastDesc: "Muestra el resultado anterior al instante. Solo se guardan localmente rutas, tamaños, fechas y contadores.",
    followLinks: "Seguir enlaces simbólicos",
    followLinksDesc: "Manténgalo desactivado salvo que comprenda el riesgo de analizar fuera de la bóveda o crear bucles.",
    largeThreshold: "Umbral de archivo grande",
    largeThresholdDesc: "Los archivos de este tamaño o superior se resaltan, en megabytes.",
    maxRows: "Máximo de filas de tabla",
    maxRowsDesc: "Limita el número de carpetas y archivos mostrados en las tablas.",
    exclusions: "Patrones de exclusión",
    exclusionsDesc: "Un patrón glob sencillo por línea, aplicado a rutas relativas a la bóveda.",
    clearCurrent: "Borrar resultado actual",
    clearCurrentDesc: "Borra la visualización de la memoria. No se elimina ningún archivo.",
    clearCache: "Borrar resultado en caché",
    clearCacheDesc: "Elimina solo la caché local de metadatos del complemento.",
    clear: "Borrar",
    folder: "Carpeta",
    file: "Archivo",
    helpTreemap: "Pulse para seleccionar. Haga doble clic en una carpeta para entrar o en un archivo para abrirlo. El clic derecho lo muestra en el explorador.",
    largeFilesTitle: "Se detectaron {count} archivo(s) grande(s)",
    largeFilesDesc: "El mayor es {path} con {size}. Revise medios, exportaciones e índices generados antes de sincronizarlos.",
    obsidianTitle: "Obsidian ocupa {percent} de la bóveda",
    obsidianDesc: "Los datos e índices de complementos usan {size}. Abra la clasificación de carpetas para identificar el complemento o caché responsable.",
    copilotTitle: "Los índices de Copilot usan {size}",
    copilotDesc: "Son índices locales derivados. Considere dividirlos y excluirlos de sincronizaciones de terceros.",
    attachmentsTitle: "Los adjuntos dominan el almacenamiento",
    attachmentsDesc: "{path} usa {size} ({percent}). Considere compresión, archivo o sincronización selectiva.",
    unreadableTitle: "No se pudieron leer {count} elementos",
    unreadableDesc: "Los totales pueden estar incompletos por permisos, bloqueos temporales, enlaces rotos o archivos en la nube no disponibles.",
    about: "Acerca de",
    version: "Versión {version}",
    openStorageMap: "Abrir mapa de almacenamiento",
    scanVaultStorage: "Analizar almacenamiento de la bóveda",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  it: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Analisi visiva dello spazio di archiviazione",
    localReadOnly: "Locale · Analisi in sola lettura · Nessun caricamento",
    developedBy: "Sviluppato da AIMETON · Dimar4713",
    scan: "Analizza vault",
    rescan: "Analizza di nuovo",
    scanning: "Analisi…",
    cancel: "Annulla",
    fastScanHint: "I vault piccoli possono terminare prima che tu riesca a premere Annulla. Quando questo pannello è attivo, Esc annulla anche l’analisi.",
    breadcrumbLabel: "Percorso cartelle",
    breadcrumbHelp: "Questa traccia di navigazione mostra la cartella corrente. Fai clic su un segmento per tornare a quel livello.",
    search: "Cerca file o cartelle…",
    allSizes: "Tutte le dimensioni",
    over1mb: "Oltre 1 MB",
    over10mb: "Oltre 10 MB",
    over100mb: "Oltre 100 MB",
    summary: "Panoramica",
    treemap: "Mappa",
    folders: "Cartelle",
    files: "File",
    fileTypes: "Tipi di file",
    recommendations: "Consigli",
    emptyTitle: "Scopri cosa occupa il tuo vault",
    emptyText: "Analizza note, allegati, dati dei plugin, indici e cartelle nascoste. Vengono letti solo i metadati; nulla viene caricato o eliminato.",
    previousScan: "Analisi precedente",
    scannedProgress: "Analizzati {files} file e {folders} cartelle",
    starting: "Avvio…",
    totalSize: "Dimensione totale",
    scanTime: "Tempo di analisi",
    obsidianSize: "Dimensione di Obsidian",
    largestFolder: "Cartella più grande",
    largestFile: "File più grande",
    changeSinceLast: "Variazione dall’ultima analisi",
    noPreviousComparison: "Esegui un’altra analisi per confrontare la crescita dello spazio.",
    topFolders: "Cartelle più grandi",
    topFiles: "File più grandi",
    scannedAt: "Analizzato il {date}",
    unreadableEntries: "{count} elementi illeggibili",
    noData: "Nessun dato.",
    noMatches: "Nessun elemento corrisponde ai filtri attuali.",
    path: "Percorso",
    size: "Dimensione",
    type: "Tipo",
    modified: "Modificato",
    actions: "Azioni",
    percentVault: "% del vault",
    reveal: "Mostra nel file manager",
    copyPath: "Copia percorso assoluto",
    copied: "Copiato.",
    open: "Apri",
    drillDown: "Apri cartella nella mappa",
    storageByType: "Spazio per tipo di file",
    details: "Dettagli",
    showDetails: "Mostra dettagli",
    hideDetails: "Nascondi dettagli",
    selectItem: "Seleziona un blocco della mappa o una riga della tabella.",
    itemKind: "Categoria",
    itemFiles: "File contenuti",
    itemFolders: "Cartelle contenute",
    shareVault: "Quota del vault",
    shareParent: "Quota della cartella padre",
    diagnosticOnly: "I consigli sono solo diagnostici. Il plugin non elimina, sposta o esclude mai automaticamente i file.",
    noRisks: "Nessun rischio evidente rilevato con le soglie attuali.",
    copyRule: "Copia regola di esclusione",
    exportMd: "Esporta Markdown",
    exportCsv: "Esporta CSV",
    exportJson: "Esporta JSON",
    exportCreated: "Rapporto creato: {path}",
    exportFailed: "Esportazione non riuscita: {error}",
    scanComplete: "Analisi completata: {size} in {files} file.",
    scanCancelled: "Analisi annullata.",
    scanFailed: "Analisi non riuscita: {error}",
    desktopRequired: "Vault Storage Map richiede la versione desktop e un percorso locale del vault.",
    cachedResult: "Visualizzazione dell’analisi in cache del {date}",
    cacheSkipped: "L’analisi è troppo grande per una cache sicura; i risultati restano disponibili.",
    cacheCleared: "Cache dell’analisi cancellata.",
    themeSystem: "Sistema",
    themeLight: "Chiaro",
    themeDark: "Scuro",
    languageAuto: "Automatico",
    colorType: "Per tipo di file",
    colorSize: "Per dimensione",
    colorDepth: "Per profondità",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Lingua dell’interfaccia",
    languageDesc: "Automatico segue la lingua di Obsidian o del sistema operativo.",
    themeSetting: "Tema dell’interfaccia",
    themeDesc: "Sistema segue Obsidian. Chiaro e scuro modificano solo il pannello del plugin.",
    colorSetting: "Colori della mappa",
    colorDesc: "Scegli se il colore rappresenta tipo di file, dimensione relativa o profondità.",
    includeHidden: "Includi file e cartelle nascosti",
    includeHiddenDesc: "Include i nomi che iniziano con un punto. Consigliato per la diagnostica.",
    includeObsidian: "Includi Obsidian",
    includeObsidianDesc: "Analizza dati dei plugin, indici, cache e file di configurazione.",
    scanOnOpen: "Analizza all’apertura della vista",
    scanOnOpenDesc: "Disattivato per impostazione predefinita per evitare attività disco non necessaria.",
    cacheLast: "Memorizza l’ultima analisi",
    cacheLastDesc: "Mostra subito il risultato precedente. Solo percorsi, dimensioni, date e conteggi sono salvati localmente.",
    followLinks: "Segui collegamenti simbolici",
    followLinksDesc: "Lascialo disattivato se non comprendi il rischio di analizzare fuori dal vault o creare cicli.",
    largeThreshold: "Soglia file grande",
    largeThresholdDesc: "I file di questa dimensione o superiore vengono evidenziati, in megabyte.",
    maxRows: "Numero massimo di righe",
    maxRowsDesc: "Limita il numero di cartelle e file mostrati nelle tabelle.",
    exclusions: "Modelli di esclusione",
    exclusionsDesc: "Un semplice pattern glob per riga, applicato ai percorsi relativi al vault.",
    clearCurrent: "Cancella risultato corrente",
    clearCurrentDesc: "Cancella la visualizzazione dalla memoria. Nessun file viene rimosso.",
    clearCache: "Cancella risultato in cache",
    clearCacheDesc: "Elimina solo la cache locale dei metadati del plugin.",
    clear: "Cancella",
    folder: "Cartella",
    file: "File",
    helpTreemap: "Fai clic per selezionare. Doppio clic su una cartella per entrare o su un file per aprirlo. Il clic destro lo mostra nel file manager.",
    largeFilesTitle: "Rilevati {count} file di grandi dimensioni",
    largeFilesDesc: "Il più grande è {path} con {size}. Controlla media, esportazioni e indici generati prima della sincronizzazione.",
    obsidianTitle: "Obsidian occupa il {percent} del vault",
    obsidianDesc: "Dati e indici dei plugin usano {size}. Apri la classifica delle cartelle per trovare il plugin o la cache responsabile.",
    copilotTitle: "Gli indici Copilot usano {size}",
    copilotDesc: "Sono indici locali derivati. Valuta di partizionarli ed escluderli dalle sincronizzazioni di terze parti.",
    attachmentsTitle: "Gli allegati dominano lo spazio del vault",
    attachmentsDesc: "{path} usa {size} ({percent}). Valuta compressione, archiviazione o sincronizzazione selettiva.",
    unreadableTitle: "Impossibile leggere {count} elementi",
    unreadableDesc: "I totali possono essere incompleti per autorizzazioni, blocchi temporanei, collegamenti interrotti o file cloud non disponibili.",
    about: "Informazioni",
    version: "Versione {version}",
    openStorageMap: "Apri mappa dello spazio",
    scanVaultStorage: "Analizza spazio del vault",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  tr: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Görsel depolama analizi",
    localReadOnly: "Yerel · Salt okunur tarama · Yükleme yok",
    developedBy: "AIMETON · Dimar4713 tarafından geliştirildi",
    scan: "Kasayı tara",
    rescan: "Yeniden tara",
    scanning: "Taranıyor…",
    cancel: "İptal",
    fastScanHint: "Küçük kasalar İptal düğmesine basamadan tamamlanabilir. Bu panel odaktayken Esc tuşu da taramayı iptal eder.",
    breadcrumbLabel: "Klasör yolu",
    breadcrumbHelp: "Bu gezinme yolu geçerli klasörü gösterir. O düzeye dönmek için herhangi bir bölüme tıklayın.",
    search: "Dosya veya klasör ara…",
    allSizes: "Tüm boyutlar",
    over1mb: "1 MB üzeri",
    over10mb: "10 MB üzeri",
    over100mb: "100 MB üzeri",
    summary: "Özet",
    treemap: "Harita",
    folders: "Klasörler",
    files: "Dosyalar",
    fileTypes: "Dosya türleri",
    recommendations: "Öneriler",
    emptyTitle: "Kasanızda neyin yer kapladığını görün",
    emptyText: "Notları, ekleri, eklenti verilerini, dizinleri ve gizli klasörleri tarayın. Yalnızca dosya meta verileri okunur; hiçbir şey yüklenmez veya silinmez.",
    previousScan: "Önceki tarama",
    scannedProgress: "{files} dosya ve {folders} klasör tarandı",
    starting: "Başlatılıyor…",
    totalSize: "Toplam boyut",
    scanTime: "Tarama süresi",
    obsidianSize: "Obsidian boyutu",
    largestFolder: "En büyük klasör",
    largestFile: "En büyük dosya",
    changeSinceLast: "Son taramadan bu yana değişim",
    noPreviousComparison: "Depolama büyümesini karşılaştırmak için başka bir tarama çalıştırın.",
    topFolders: "En büyük klasörler",
    topFiles: "En büyük dosyalar",
    scannedAt: "Tarama: {date}",
    unreadableEntries: "{count} okunamayan öğe",
    noData: "Veri yok.",
    noMatches: "Geçerli filtrelerle eşleşen öğe yok.",
    path: "Yol",
    size: "Boyut",
    type: "Tür",
    modified: "Değiştirildi",
    actions: "İşlemler",
    percentVault: "Kasanın %’si",
    reveal: "Dosya yöneticisinde göster",
    copyPath: "Mutlak yolu kopyala",
    copied: "Kopyalandı.",
    open: "Aç",
    drillDown: "Klasörü haritada aç",
    storageByType: "Dosya türüne göre depolama",
    details: "Ayrıntılar",
    showDetails: "Ayrıntıları göster",
    hideDetails: "Ayrıntıları gizle",
    selectItem: "İncelemek için bir harita bloğu veya tablo satırı seçin.",
    itemKind: "Tür",
    itemFiles: "İçindeki dosyalar",
    itemFolders: "İçindeki klasörler",
    shareVault: "Kasadaki payı",
    shareParent: "Üst klasördeki payı",
    diagnosticOnly: "Öneriler yalnızca tanılama amaçlıdır. Eklenti dosyaları otomatik olarak silmez, taşımaz veya hariç tutmaz.",
    noRisks: "Geçerli eşiklerle belirgin bir depolama riski algılanmadı.",
    copyRule: "Hariç tutma kuralını kopyala",
    exportMd: "Markdown dışa aktar",
    exportCsv: "CSV dışa aktar",
    exportJson: "JSON dışa aktar",
    exportCreated: "Rapor oluşturuldu: {path}",
    exportFailed: "Dışa aktarma başarısız: {error}",
    scanComplete: "Tarama tamamlandı: {files} dosyada {size}.",
    scanCancelled: "Tarama iptal edildi.",
    scanFailed: "Tarama başarısız: {error}",
    desktopRequired: "Vault Storage Map masaüstü sürümü ve yerel bir kasa yolu gerektirir.",
    cachedResult: "{date} tarihli önbellek taraması gösteriliyor",
    cacheSkipped: "Tarama güvenli şekilde önbelleğe alınamayacak kadar büyük; canlı sonuçlar kullanılabilir.",
    cacheCleared: "Önbelleğe alınmış tarama temizlendi.",
    themeSystem: "Sistem",
    themeLight: "Açık",
    themeDark: "Koyu",
    languageAuto: "Otomatik",
    colorType: "Dosya türüne göre",
    colorSize: "Boyuta göre",
    colorDepth: "Derinliğe göre",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Arayüz dili",
    languageDesc: "Otomatik, Obsidian veya işletim sistemi dilini izler.",
    themeSetting: "Arayüz teması",
    themeDesc: "Sistem, Obsidian’ı izler. Açık ve koyu yalnızca eklenti panelini değiştirir.",
    colorSetting: "Harita renkleri",
    colorDesc: "Rengin dosya türünü, göreli boyutu veya klasör derinliğini göstermesini seçin.",
    includeHidden: "Gizli dosya ve klasörleri dahil et",
    includeHiddenDesc: "Nokta ile başlayan adları içerir. Depolama tanılaması için önerilir.",
    includeObsidian: "Obsidian klasörünü dahil et",
    includeObsidianDesc: "Eklenti verilerini, dizinleri, önbellekleri ve yapılandırma dosyalarını tarar.",
    scanOnOpen: "Görünüm açıldığında tara",
    scanOnOpenDesc: "Gereksiz disk etkinliğini önlemek için varsayılan olarak kapalıdır.",
    cacheLast: "Son taramayı önbelleğe al",
    cacheLastDesc: "Önceki sonucu hemen gösterir. Yalnızca yollar, boyutlar, tarihler ve sayılar yerel olarak saklanır.",
    followLinks: "Sembolik bağlantıları izle",
    followLinksDesc: "Kasa dışını tarama veya döngü oluşturma riskini anlamıyorsanız kapalı tutun.",
    largeThreshold: "Büyük dosya eşiği",
    largeThresholdDesc: "Bu boyutta veya daha büyük dosyalar megabayt cinsinden vurgulanır.",
    maxRows: "En fazla tablo satırı",
    maxRowsDesc: "Tablolarda gösterilen klasör ve dosya sayısını sınırlar.",
    exclusions: "Hariç tutma desenleri",
    exclusionsDesc: "Kasa göreli yollarıyla eşleşen, satır başına bir basit glob deseni.",
    clearCurrent: "Geçerli sonucu temizle",
    clearCurrentDesc: "Görselleştirmeyi bellekten temizler. Kasa dosyaları kaldırılmaz.",
    clearCache: "Önbellek sonucunu temizle",
    clearCacheDesc: "Yalnızca eklentinin yerel meta veri önbelleğini siler.",
    clear: "Temizle",
    folder: "Klasör",
    file: "Dosya",
    helpTreemap: "Seçmek için tıklayın. İçeri girmek için klasöre, açmak için dosyaya çift tıklayın. Sağ tık dosya yöneticisinde gösterir.",
    largeFilesTitle: "{count} büyük dosya algılandı",
    largeFilesDesc: "En büyüğü {path}, {size}. Eşitlemeden önce büyük medya, dışa aktarımlar ve oluşturulan dizinleri inceleyin.",
    obsidianTitle: "Obsidian kasanın {percent} kadarını kaplıyor",
    obsidianDesc: "Eklenti verileri ve dizinler {size} kullanıyor. Sorumlu eklenti veya önbelleği bulmak için klasör sıralamasını açın.",
    copilotTitle: "Copilot dizin dosyaları {size} kullanıyor",
    copilotDesc: "Bunlar türetilmiş yerel dizinlerdir. Bölümlere ayırmayı ve üçüncü taraf eşitlemeden hariç tutmayı düşünün.",
    attachmentsTitle: "Ekler kasa depolamasına hakim",
    attachmentsDesc: "{path}, {size} ({percent}) kullanıyor. Sıkıştırma, arşivleme veya seçmeli eşitlemeyi düşünün.",
    unreadableTitle: "{count} öğe okunamadı",
    unreadableDesc: "İzinler, geçici kilitler, bozuk bağlantılar veya kullanılamayan bulut dosyaları nedeniyle toplamlar eksik olabilir.",
    about: "Hakkında",
    version: "Sürüm {version}",
    openStorageMap: "Depolama haritasını aç",
    scanVaultStorage: "Kasa depolamasını tara",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  hi: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "स्टोरेज का दृश्य विश्लेषण",
    localReadOnly: "स्थानीय · केवल-पठन स्कैन · कोई अपलोड नहीं",
    developedBy: "AIMETON · Dimar4713 द्वारा विकसित",
    scan: "वॉल्ट स्कैन करें",
    rescan: "फिर से स्कैन करें",
    scanning: "स्कैन हो रहा है…",
    cancel: "रद्द करें",
    fastScanHint: "छोटे वॉल्ट रद्द दबाने से पहले ही पूरे हो सकते हैं। यह पैनल सक्रिय होने पर Esc से भी स्कैन रद्द होता है।",
    breadcrumbLabel: "फ़ोल्डर पथ",
    breadcrumbHelp: "यह नेविगेशन पथ वर्तमान फ़ोल्डर दिखाता है। उस स्तर पर लौटने के लिए किसी भाग पर क्लिक करें।",
    search: "फ़ाइलें या फ़ोल्डर खोजें…",
    allSizes: "सभी आकार",
    over1mb: "1 MB से अधिक",
    over10mb: "10 MB से अधिक",
    over100mb: "100 MB से अधिक",
    summary: "सारांश",
    treemap: "मानचित्र",
    folders: "फ़ोल्डर",
    files: "फ़ाइलें",
    fileTypes: "फ़ाइल प्रकार",
    recommendations: "सुझाव",
    emptyTitle: "देखें आपका वॉल्ट क्या जगह ले रहा है",
    emptyText: "नोट्स, अटैचमेंट, प्लगइन डेटा, इंडेक्स और छिपे फ़ोल्डर स्कैन करें। केवल मेटाडेटा पढ़ा जाता है; कुछ भी अपलोड या हटाया नहीं जाता।",
    previousScan: "पिछला स्कैन",
    scannedProgress: "{files} फ़ाइलें और {folders} फ़ोल्डर स्कैन हुए",
    starting: "शुरू हो रहा है…",
    totalSize: "कुल आकार",
    scanTime: "स्कैन समय",
    obsidianSize: "Obsidian का आकार",
    largestFolder: "सबसे बड़ा फ़ोल्डर",
    largestFile: "सबसे बड़ी फ़ाइल",
    changeSinceLast: "पिछले स्कैन से बदलाव",
    noPreviousComparison: "स्टोरेज वृद्धि की तुलना के लिए एक और स्कैन चलाएँ।",
    topFolders: "सबसे बड़े फ़ोल्डर",
    topFiles: "सबसे बड़ी फ़ाइलें",
    scannedAt: "स्कैन: {date}",
    unreadableEntries: "{count} प्रविष्टियाँ पढ़ी नहीं जा सकीं",
    noData: "कोई डेटा नहीं।",
    noMatches: "वर्तमान फ़िल्टर से कोई आइटम नहीं मिला।",
    path: "पथ",
    size: "आकार",
    type: "प्रकार",
    modified: "संशोधित",
    actions: "क्रियाएँ",
    percentVault: "वॉल्ट का %",
    reveal: "फ़ाइल एक्सप्लोरर में दिखाएँ",
    copyPath: "पूर्ण पथ कॉपी करें",
    copied: "कॉपी किया गया।",
    open: "खोलें",
    drillDown: "फ़ोल्डर को मानचित्र में खोलें",
    storageByType: "फ़ाइल प्रकार के अनुसार स्टोरेज",
    details: "विवरण",
    showDetails: "विवरण दिखाएँ",
    hideDetails: "विवरण छिपाएँ",
    selectItem: "जाँचने के लिए मानचित्र ब्लॉक या तालिका पंक्ति चुनें।",
    itemKind: "श्रेणी",
    itemFiles: "अंदर की फ़ाइलें",
    itemFolders: "अंदर के फ़ोल्डर",
    shareVault: "वॉल्ट में हिस्सा",
    shareParent: "मूल फ़ोल्डर में हिस्सा",
    diagnosticOnly: "सुझाव केवल निदान के लिए हैं। प्लगइन फ़ाइलों को अपने आप हटाता, स्थानांतरित या बाहर नहीं करता।",
    noRisks: "वर्तमान सीमाओं पर कोई स्पष्ट स्टोरेज जोखिम नहीं मिला।",
    copyRule: "बहिष्करण नियम कॉपी करें",
    exportMd: "Markdown निर्यात करें",
    exportCsv: "CSV निर्यात करें",
    exportJson: "JSON निर्यात करें",
    exportCreated: "रिपोर्ट बनाई गई: {path}",
    exportFailed: "निर्यात विफल: {error}",
    scanComplete: "स्कैन पूरा: {files} फ़ाइलों में {size}.",
    scanCancelled: "स्कैन रद्द हुआ।",
    scanFailed: "स्कैन विफल: {error}",
    desktopRequired: "Vault Storage Map के लिए डेस्कटॉप संस्करण और स्थानीय वॉल्ट पथ आवश्यक है।",
    cachedResult: "{date} का कैश स्कैन दिखाया जा रहा है",
    cacheSkipped: "स्कैन सुरक्षित कैश के लिए बहुत बड़ा है; वर्तमान परिणाम उपलब्ध रहेंगे।",
    cacheCleared: "कैश स्कैन साफ किया गया।",
    themeSystem: "सिस्टम",
    themeLight: "हल्का",
    themeDark: "गहरा",
    languageAuto: "स्वचालित",
    colorType: "फ़ाइल प्रकार के अनुसार",
    colorSize: "आकार के अनुसार",
    colorDepth: "गहराई के अनुसार",
    settingsTitle: "Vault Storage Map",
    languageSetting: "इंटरफ़ेस भाषा",
    languageDesc: "स्वचालित मोड Obsidian या ऑपरेटिंग सिस्टम की भाषा का अनुसरण करता है।",
    themeSetting: "इंटरफ़ेस थीम",
    themeDesc: "सिस्टम Obsidian का अनुसरण करता है। हल्का और गहरा केवल प्लगइन पैनल बदलते हैं।",
    colorSetting: "मानचित्र रंग",
    colorDesc: "चुनें कि रंग फ़ाइल प्रकार, सापेक्ष आकार या फ़ोल्डर गहराई दर्शाए।",
    includeHidden: "छिपी फ़ाइलें और फ़ोल्डर शामिल करें",
    includeHiddenDesc: "डॉट से शुरू होने वाले नाम शामिल करता है। स्टोरेज निदान के लिए अनुशंसित।",
    includeObsidian: "Obsidian शामिल करें",
    includeObsidianDesc: "प्लगइन डेटा, इंडेक्स, कैश और कॉन्फ़िगरेशन फ़ाइलें स्कैन करें।",
    scanOnOpen: "दृश्य खुलने पर स्कैन करें",
    scanOnOpenDesc: "अनावश्यक डिस्क गतिविधि से बचने के लिए डिफ़ॉल्ट रूप से बंद।",
    cacheLast: "पिछला स्कैन कैश करें",
    cacheLastDesc: "पिछला परिणाम तुरंत दिखाता है। केवल पथ, आकार, तिथियाँ और गिनती स्थानीय रूप से रखी जाती हैं।",
    followLinks: "सिम्बॉलिक लिंक का अनुसरण करें",
    followLinksDesc: "वॉल्ट के बाहर स्कैन या लूप बनने का जोखिम समझे बिना इसे चालू न करें।",
    largeThreshold: "बड़ी फ़ाइल की सीमा",
    largeThresholdDesc: "इस आकार या उससे बड़ी फ़ाइलें मेगाबाइट में हाइलाइट होती हैं।",
    maxRows: "अधिकतम तालिका पंक्तियाँ",
    maxRowsDesc: "तालिकाओं में दिखाए गए फ़ोल्डर और फ़ाइलों की संख्या सीमित करता है।",
    exclusions: "बहिष्करण पैटर्न",
    exclusionsDesc: "प्रति पंक्ति एक सरल glob पैटर्न, वॉल्ट-सापेक्ष पथों पर लागू।",
    clearCurrent: "वर्तमान परिणाम साफ करें",
    clearCurrentDesc: "मेमोरी से दृश्य साफ करता है। कोई वॉल्ट फ़ाइल नहीं हटती।",
    clearCache: "कैश परिणाम साफ करें",
    clearCacheDesc: "केवल प्लगइन का स्थानीय मेटाडेटा कैश हटाता है।",
    clear: "साफ करें",
    folder: "फ़ोल्डर",
    file: "फ़ाइल",
    helpTreemap: "चुनने के लिए क्लिक करें। अंदर जाने के लिए फ़ोल्डर पर या खोलने के लिए फ़ाइल पर डबल-क्लिक करें। दायाँ क्लिक एक्सप्लोरर में दिखाता है।",
    largeFilesTitle: "{count} बड़ी फ़ाइलें मिलीं",
    largeFilesDesc: "सबसे बड़ी {path} है, आकार {size}। सिंक से पहले बड़े मीडिया, निर्यात और बनाए गए इंडेक्स देखें।",
    obsidianTitle: "Obsidian वॉल्ट का {percent} लेता है",
    obsidianDesc: "प्लगइन डेटा और इंडेक्स {size} उपयोग करते हैं। जिम्मेदार प्लगइन या कैश पहचानने के लिए फ़ोल्डर रैंकिंग खोलें।",
    copilotTitle: "Copilot इंडेक्स फ़ाइलें {size} उपयोग करती हैं",
    copilotDesc: "ये बने हुए स्थानीय इंडेक्स हैं। इन्हें विभाजित करने और तृतीय-पक्ष सिंक से बाहर रखने पर विचार करें।",
    attachmentsTitle: "अटैचमेंट सबसे अधिक स्टोरेज लेते हैं",
    attachmentsDesc: "{path} {size} ({percent}) उपयोग करता है। संपीड़न, संग्रह या चयनित सिंक पर विचार करें।",
    unreadableTitle: "{count} प्रविष्टियाँ पढ़ी नहीं जा सकीं",
    unreadableDesc: "अनुमतियों, अस्थायी लॉक, टूटे लिंक या अनुपलब्ध क्लाउड फ़ाइलों के कारण कुल अधूरा हो सकता है।",
    about: "परिचय",
    version: "संस्करण {version}",
    openStorageMap: "स्टोरेज मानचित्र खोलें",
    scanVaultStorage: "वॉल्ट स्टोरेज स्कैन करें",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  bn: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "স্টোরেজের দৃশ্যমান বিশ্লেষণ",
    localReadOnly: "স্থানীয় · শুধু-পঠন স্ক্যান · কোনো আপলোড নয়",
    developedBy: "AIMETON · Dimar4713 দ্বারা তৈরি",
    scan: "ভল্ট স্ক্যান করুন",
    rescan: "আবার স্ক্যান করুন",
    scanning: "স্ক্যান চলছে…",
    cancel: "বাতিল",
    fastScanHint: "ছোট ভল্টে বাতিল চাপার আগেই স্ক্যান শেষ হতে পারে। এই প্যানেল সক্রিয় থাকলে Esc-ও স্ক্যান বাতিল করে।",
    breadcrumbLabel: "ফোল্ডারের পথ",
    breadcrumbHelp: "এই নেভিগেশন পথ বর্তমান ফোল্ডার দেখায়। কোনো অংশে ক্লিক করলে সেই স্তরে ফিরে যাবেন।",
    search: "ফাইল বা ফোল্ডার খুঁজুন…",
    allSizes: "সব আকার",
    over1mb: "1 MB-এর বেশি",
    over10mb: "10 MB-এর বেশি",
    over100mb: "100 MB-এর বেশি",
    summary: "সারাংশ",
    treemap: "মানচিত্র",
    folders: "ফোল্ডার",
    files: "ফাইল",
    fileTypes: "ফাইলের ধরন",
    recommendations: "পরামর্শ",
    emptyTitle: "আপনার ভল্টে কী জায়গা নিচ্ছে দেখুন",
    emptyText: "নোট, সংযুক্তি, প্লাগইন ডেটা, ইনডেক্স এবং লুকানো ফোল্ডার স্ক্যান করুন। শুধু মেটাডেটা পড়া হয়; কিছু আপলোড বা মুছে ফেলা হয় না।",
    previousScan: "আগের স্ক্যান",
    scannedProgress: "{files}টি ফাইল ও {folders}টি ফোল্ডার স্ক্যান হয়েছে",
    starting: "শুরু হচ্ছে…",
    totalSize: "মোট আকার",
    scanTime: "স্ক্যানের সময়",
    obsidianSize: "Obsidian-এর আকার",
    largestFolder: "সবচেয়ে বড় ফোল্ডার",
    largestFile: "সবচেয়ে বড় ফাইল",
    changeSinceLast: "শেষ স্ক্যানের পর পরিবর্তন",
    noPreviousComparison: "স্টোরেজ বৃদ্ধির তুলনা করতে আরেকটি স্ক্যান চালান।",
    topFolders: "সবচেয়ে বড় ফোল্ডার",
    topFiles: "সবচেয়ে বড় ফাইল",
    scannedAt: "স্ক্যান: {date}",
    unreadableEntries: "{count}টি আইটেম পড়া যায়নি",
    noData: "কোনো ডেটা নেই।",
    noMatches: "বর্তমান ফিল্টারে কোনো আইটেম মেলেনি।",
    path: "পথ",
    size: "আকার",
    type: "ধরন",
    modified: "পরিবর্তিত",
    actions: "কাজ",
    percentVault: "ভল্টের %",
    reveal: "ফাইল এক্সপ্লোরারে দেখান",
    copyPath: "পূর্ণ পথ কপি করুন",
    copied: "কপি হয়েছে।",
    open: "খুলুন",
    drillDown: "মানচিত্রে ফোল্ডার খুলুন",
    storageByType: "ফাইলের ধরন অনুযায়ী স্টোরেজ",
    details: "বিস্তারিত",
    showDetails: "বিস্তারিত দেখান",
    hideDetails: "বিস্তারিত লুকান",
    selectItem: "পরীক্ষা করতে মানচিত্রের ব্লক বা টেবিলের সারি নির্বাচন করুন।",
    itemKind: "শ্রেণি",
    itemFiles: "ভিতরের ফাইল",
    itemFolders: "ভিতরের ফোল্ডার",
    shareVault: "ভল্টের অংশ",
    shareParent: "মূল ফোল্ডারের অংশ",
    diagnosticOnly: "পরামর্শ শুধু নির্ণয়ের জন্য। প্লাগইন স্বয়ংক্রিয়ভাবে ফাইল মুছে, সরায় বা বাদ দেয় না।",
    noRisks: "বর্তমান সীমায় স্পষ্ট কোনো স্টোরেজ ঝুঁকি পাওয়া যায়নি।",
    copyRule: "বাদ দেওয়ার নিয়ম কপি করুন",
    exportMd: "Markdown রপ্তানি",
    exportCsv: "CSV রপ্তানি",
    exportJson: "JSON রপ্তানি",
    exportCreated: "রিপোর্ট তৈরি হয়েছে: {path}",
    exportFailed: "রপ্তানি ব্যর্থ: {error}",
    scanComplete: "স্ক্যান সম্পন্ন: {files}টি ফাইলে {size}.",
    scanCancelled: "স্ক্যান বাতিল হয়েছে।",
    scanFailed: "স্ক্যান ব্যর্থ: {error}",
    desktopRequired: "Vault Storage Map-এর জন্য ডেস্কটপ সংস্করণ এবং স্থানীয় ভল্ট পথ প্রয়োজন।",
    cachedResult: "{date}-এর ক্যাশ স্ক্যান দেখানো হচ্ছে",
    cacheSkipped: "নিরাপদে ক্যাশ করার জন্য স্ক্যানটি খুব বড়; বর্তমান ফলাফল থাকবে।",
    cacheCleared: "ক্যাশ স্ক্যান পরিষ্কার করা হয়েছে।",
    themeSystem: "সিস্টেম",
    themeLight: "হালকা",
    themeDark: "গাঢ়",
    languageAuto: "স্বয়ংক্রিয়",
    colorType: "ফাইলের ধরন অনুযায়ী",
    colorSize: "আকার অনুযায়ী",
    colorDepth: "গভীরতা অনুযায়ী",
    settingsTitle: "Vault Storage Map",
    languageSetting: "ইন্টারফেসের ভাষা",
    languageDesc: "স্বয়ংক্রিয় মোড Obsidian বা অপারেটিং সিস্টেমের ভাষা অনুসরণ করে।",
    themeSetting: "ইন্টারফেস থিম",
    themeDesc: "সিস্টেম Obsidian অনুসরণ করে। হালকা ও গাঢ় শুধু প্লাগইন প্যানেল বদলায়।",
    colorSetting: "মানচিত্রের রং",
    colorDesc: "রংটি ফাইলের ধরন, আপেক্ষিক আকার বা ফোল্ডারের গভীরতা দেখাবে কিনা বেছে নিন।",
    includeHidden: "লুকানো ফাইল ও ফোল্ডার অন্তর্ভুক্ত করুন",
    includeHiddenDesc: "ডট দিয়ে শুরু হওয়া নাম অন্তর্ভুক্ত করে। স্টোরেজ নির্ণয়ের জন্য সুপারিশকৃত।",
    includeObsidian: "Obsidian অন্তর্ভুক্ত করুন",
    includeObsidianDesc: "প্লাগইন ডেটা, ইনডেক্স, ক্যাশ এবং কনফিগারেশন ফাইল স্ক্যান করুন।",
    scanOnOpen: "ভিউ খোলার সময় স্ক্যান করুন",
    scanOnOpenDesc: "অপ্রয়োজনীয় ডিস্ক কার্যকলাপ এড়াতে ডিফল্টভাবে বন্ধ।",
    cacheLast: "শেষ স্ক্যান ক্যাশ করুন",
    cacheLastDesc: "আগের ফলাফল সঙ্গে সঙ্গে দেখায়। শুধু পথ, আকার, তারিখ ও সংখ্যা স্থানীয়ভাবে রাখা হয়।",
    followLinks: "সিম্বলিক লিংক অনুসরণ করুন",
    followLinksDesc: "ভল্টের বাইরে স্ক্যান বা লুপ তৈরির ঝুঁকি না বুঝলে বন্ধ রাখুন।",
    largeThreshold: "বড় ফাইলের সীমা",
    largeThresholdDesc: "এই আকার বা তার বেশি ফাইল মেগাবাইটে হাইলাইট করা হয়।",
    maxRows: "টেবিলের সর্বোচ্চ সারি",
    maxRowsDesc: "টেবিলে দেখানো ফোল্ডার ও ফাইলের সংখ্যা সীমিত করে।",
    exclusions: "বাদ দেওয়ার প্যাটার্ন",
    exclusionsDesc: "প্রতি লাইনে একটি সহজ glob প্যাটার্ন, ভল্ট-আপেক্ষিক পথে প্রয়োগ হয়।",
    clearCurrent: "বর্তমান ফলাফল পরিষ্কার করুন",
    clearCurrentDesc: "মেমরি থেকে দৃশ্য পরিষ্কার করে। কোনো ভল্ট ফাইল মুছে না।",
    clearCache: "ক্যাশ ফলাফল পরিষ্কার করুন",
    clearCacheDesc: "শুধু প্লাগইনের স্থানীয় মেটাডেটা ক্যাশ মুছে।",
    clear: "পরিষ্কার",
    folder: "ফোল্ডার",
    file: "ফাইল",
    helpTreemap: "নির্বাচন করতে ক্লিক করুন। ভিতরে যেতে ফোল্ডারে বা খুলতে ফাইলে ডাবল-ক্লিক করুন। ডান ক্লিক এক্সপ্লোরারে দেখায়।",
    largeFilesTitle: "{count}টি বড় ফাইল পাওয়া গেছে",
    largeFilesDesc: "সবচেয়ে বড় {path}, আকার {size}। সিঙ্কের আগে বড় মিডিয়া, রপ্তানি ও তৈরি ইনডেক্স দেখুন।",
    obsidianTitle: "Obsidian ভল্টের {percent} দখল করে",
    obsidianDesc: "প্লাগইন ডেটা ও ইনডেক্স {size} ব্যবহার করে। দায়ী প্লাগইন বা ক্যাশ খুঁজতে ফোল্ডার র‌্যাঙ্কিং খুলুন।",
    copilotTitle: "Copilot ইনডেক্স ফাইল {size} ব্যবহার করে",
    copilotDesc: "এগুলো তৈরি করা স্থানীয় ইনডেক্স। ভাগ করা এবং তৃতীয়-পক্ষ সিঙ্ক থেকে বাদ দেওয়ার কথা ভাবুন।",
    attachmentsTitle: "সংযুক্তিগুলো সবচেয়ে বেশি স্টোরেজ নিচ্ছে",
    attachmentsDesc: "{path} {size} ({percent}) ব্যবহার করে। কম্প্রেশন, আর্কাইভ বা নির্বাচিত সিঙ্ক বিবেচনা করুন।",
    unreadableTitle: "{count}টি আইটেম পড়া যায়নি",
    unreadableDesc: "অনুমতি, সাময়িক লক, ভাঙা লিংক বা অনুপলব্ধ ক্লাউড ফাইলের কারণে মোট অসম্পূর্ণ হতে পারে।",
    about: "সম্পর্কে",
    version: "সংস্করণ {version}",
    openStorageMap: "স্টোরেজ মানচিত্র খুলুন",
    scanVaultStorage: "ভল্ট স্টোরেজ স্ক্যান করুন",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  ta: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "சேமிப்பகத்தின் காட்சி பகுப்பாய்வு",
    localReadOnly: "உள்ளூர் · வாசிப்பு மட்டும் ஸ்கேன் · பதிவேற்றம் இல்லை",
    developedBy: "AIMETON · Dimar4713 உருவாக்கியது",
    scan: "வால்ட்டை ஸ்கேன் செய்",
    rescan: "மீண்டும் ஸ்கேன் செய்",
    scanning: "ஸ்கேன் செய்கிறது…",
    cancel: "ரத்து செய்",
    fastScanHint: "சிறிய வால்ட்கள் ரத்து பொத்தானை அழுத்தும் முன்பே முடிந்துவிடலாம். இந்தப் பலகம் செயலில் இருக்கும்போது Esc விசையும் ஸ்கேனை ரத்து செய்யும்.",
    breadcrumbLabel: "கோப்புறை பாதை",
    breadcrumbHelp: "இந்த வழிசெலுத்தல் பாதை தற்போதைய கோப்புறையை காட்டுகிறது. அந்த நிலைக்கு திரும்ப எந்த பகுதியையும் கிளிக் செய்யவும்.",
    search: "கோப்புகள் அல்லது கோப்புறைகளை தேடு…",
    allSizes: "அனைத்து அளவுகள்",
    over1mb: "1 MB-க்கு மேல்",
    over10mb: "10 MB-க்கு மேல்",
    over100mb: "100 MB-க்கு மேல்",
    summary: "சுருக்கம்",
    treemap: "வரைபடம்",
    folders: "கோப்புறைகள்",
    files: "கோப்புகள்",
    fileTypes: "கோப்பு வகைகள்",
    recommendations: "பரிந்துரைகள்",
    emptyTitle: "உங்கள் வால்ட்டில் இடம் பிடிப்பதை காணுங்கள்",
    emptyText: "குறிப்புகள், இணைப்புகள், செருகுநிரல் தரவு, குறியீடுகள் மற்றும் மறைக்கப்பட்ட கோப்புறைகளை ஸ்கேன் செய்யவும். கோப்பு மெட்டாடேட்டா மட்டும் வாசிக்கப்படும்; எதுவும் பதிவேற்றப்படவோ நீக்கப்படவோ மாட்டாது.",
    previousScan: "முந்தைய ஸ்கேன்",
    scannedProgress: "{files} கோப்புகள் மற்றும் {folders} கோப்புறைகள் ஸ்கேன் செய்யப்பட்டன",
    starting: "தொடங்குகிறது…",
    totalSize: "மொத்த அளவு",
    scanTime: "ஸ்கேன் நேரம்",
    obsidianSize: "Obsidian அளவு",
    largestFolder: "மிகப்பெரிய கோப்புறை",
    largestFile: "மிகப்பெரிய கோப்பு",
    changeSinceLast: "கடைசி ஸ்கேனிலிருந்து மாற்றம்",
    noPreviousComparison: "சேமிப்பக வளர்ச்சியை ஒப்பிட மற்றொரு ஸ்கேன் இயக்கவும்.",
    topFolders: "மிகப்பெரிய கோப்புறைகள்",
    topFiles: "மிகப்பெரிய கோப்புகள்",
    scannedAt: "ஸ்கேன்: {date}",
    unreadableEntries: "{count} உருப்படிகளை வாசிக்க முடியவில்லை",
    noData: "தரவு இல்லை.",
    noMatches: "தற்போதைய வடிகட்டிகளுடன் பொருந்தும் உருப்படிகள் இல்லை.",
    path: "பாதை",
    size: "அளவு",
    type: "வகை",
    modified: "மாற்றப்பட்டது",
    actions: "செயல்கள்",
    percentVault: "வால்ட்டின் %",
    reveal: "கோப்பு மேலாளரில் காட்டு",
    copyPath: "முழு பாதையை நகலெடு",
    copied: "நகலெடுக்கப்பட்டது.",
    open: "திற",
    drillDown: "வரைபடத்தில் கோப்புறையைத் திற",
    storageByType: "கோப்பு வகைப்படி சேமிப்பகம்",
    details: "விவரங்கள்",
    showDetails: "விவரங்களை காட்டு",
    hideDetails: "விவரங்களை மறை",
    selectItem: "ஆய்வு செய்ய வரைபடத் தொகுதி அல்லது அட்டவணை வரியைத் தேர்ந்தெடுக்கவும்.",
    itemKind: "வகை",
    itemFiles: "உள்ளே உள்ள கோப்புகள்",
    itemFolders: "உள்ளே உள்ள கோப்புறைகள்",
    shareVault: "வால்ட்டில் பங்கு",
    shareParent: "மூல கோப்புறையில் பங்கு",
    diagnosticOnly: "பரிந்துரைகள் நோயறிதலுக்காக மட்டுமே. செருகுநிரல் தானாக கோப்புகளை நீக்கவோ நகர்த்தவோ விலக்கவோ செய்யாது.",
    noRisks: "தற்போதைய வரம்புகளில் தெளிவான சேமிப்பக அபாயங்கள் கண்டறியப்படவில்லை.",
    copyRule: "விலக்கு விதியை நகலெடு",
    exportMd: "Markdown ஏற்றுமதி",
    exportCsv: "CSV ஏற்றுமதி",
    exportJson: "JSON ஏற்றுமதி",
    exportCreated: "அறிக்கை உருவாக்கப்பட்டது: {path}",
    exportFailed: "ஏற்றுமதி தோல்வி: {error}",
    scanComplete: "ஸ்கேன் முடிந்தது: {files} கோப்புகளில் {size}.",
    scanCancelled: "ஸ்கேன் ரத்து செய்யப்பட்டது.",
    scanFailed: "ஸ்கேன் தோல்வி: {error}",
    desktopRequired: "Vault Storage Map-க்கு டெஸ்க்டாப் பதிப்பும் உள்ளூர் வால்ட் பாதையும் தேவை.",
    cachedResult: "{date} தேதியிலான கேஷ் ஸ்கேன் காட்டப்படுகிறது",
    cacheSkipped: "பாதுகாப்பாக கேஷ் செய்ய ஸ்கேன் மிகப் பெரியது; தற்போதைய முடிவுகள் கிடைக்கும்.",
    cacheCleared: "கேஷ் ஸ்கேன் அழிக்கப்பட்டது.",
    themeSystem: "அமைப்பு",
    themeLight: "ஒளி",
    themeDark: "இருள்",
    languageAuto: "தானியங்கி",
    colorType: "கோப்பு வகைப்படி",
    colorSize: "அளவுப்படி",
    colorDepth: "ஆழத்துப்படி",
    settingsTitle: "Vault Storage Map",
    languageSetting: "இடைமுக மொழி",
    languageDesc: "தானியங்கி முறை Obsidian அல்லது இயங்குதள மொழியைப் பின்பற்றும்.",
    themeSetting: "இடைமுக தீம்",
    themeDesc: "அமைப்பு Obsidian-ஐ பின்பற்றும். ஒளி மற்றும் இருள் செருகுநிரல் பலகையை மட்டும் மாற்றும்.",
    colorSetting: "வரைபட நிறங்கள்",
    colorDesc: "நிறம் கோப்பு வகை, சார்பு அளவு அல்லது கோப்புறை ஆழத்தை குறிக்குமா என்பதைத் தேர்வு செய்க.",
    includeHidden: "மறைக்கப்பட்ட கோப்புகள் மற்றும் கோப்புறைகளை சேர்க்கவும்",
    includeHiddenDesc: "புள்ளியால் தொடங்கும் பெயர்களை சேர்க்கிறது. சேமிப்பக ஆய்வுக்கு பரிந்துரைக்கப்படுகிறது.",
    includeObsidian: "Obsidian-ஐ சேர்க்கவும்",
    includeObsidianDesc: "செருகுநிரல் தரவு, குறியீடுகள், கேஷ் மற்றும் அமைப்பு கோப்புகளை ஸ்கேன் செய்க.",
    scanOnOpen: "காட்சி திறக்கும் போது ஸ்கேன் செய்",
    scanOnOpenDesc: "தேவையற்ற வட்டு செயல்பாட்டை தவிர்க்க இயல்பாக முடக்கப்பட்டுள்ளது.",
    cacheLast: "கடைசி ஸ்கேனை கேஷ் செய்",
    cacheLastDesc: "முந்தைய முடிவை உடனே காட்டும். பாதைகள், அளவுகள், தேதிகள் மற்றும் எண்ணிக்கைகள் மட்டும் உள்ளூரில் சேமிக்கப்படும்.",
    followLinks: "குறியீட்டு இணைப்புகளை பின்பற்று",
    followLinksDesc: "வால்ட்டிற்கு வெளியே ஸ்கேன் செய்யும் அல்லது சுழற்சி உருவாகும் அபாயத்தை புரியாவிட்டால் முடக்கியே வைக்கவும்.",
    largeThreshold: "பெரிய கோப்பு வரம்பு",
    largeThresholdDesc: "இந்த அளவு அல்லது அதற்கு மேற்பட்ட கோப்புகள் மெகாபைட்டில் முன்னிலைப்படுத்தப்படும்.",
    maxRows: "அதிகபட்ச அட்டவணை வரிகள்",
    maxRowsDesc: "அட்டவணைகளில் காட்டப்படும் கோப்புறைகள் மற்றும் கோப்புகளின் எண்ணிக்கையை கட்டுப்படுத்துகிறது.",
    exclusions: "விலக்கு வடிவங்கள்",
    exclusionsDesc: "வால்ட் சார்ந்த பாதைகளுக்கு பொருந்தும், ஒவ்வொரு வரியிலும் ஒரு எளிய glob வடிவம்.",
    clearCurrent: "தற்போதைய முடிவை அழி",
    clearCurrentDesc: "நினைவகத்தில் உள்ள காட்சியை அழிக்கிறது. எந்த வால்ட் கோப்பும் நீக்கப்படாது.",
    clearCache: "கேஷ் முடிவை அழி",
    clearCacheDesc: "செருகுநிரலின் உள்ளூர் மெட்டாடேட்டா கேஷை மட்டும் நீக்கும்.",
    clear: "அழி",
    folder: "கோப்புறை",
    file: "கோப்பு",
    helpTreemap: "தேர்வு செய்ய கிளிக் செய்க. உள்ளே செல்ல கோப்புறையையோ திறக்க கோப்பையையோ இருமுறை கிளிக் செய்க. வலது கிளிக் கோப்பு மேலாளரில் காட்டும்.",
    largeFilesTitle: "{count} பெரிய கோப்பு(கள்) கண்டறியப்பட்டன",
    largeFilesDesc: "மிகப்பெரியது {path}, அளவு {size}. ஒத்திசைவுக்கு முன் பெரிய ஊடகம், ஏற்றுமதி மற்றும் உருவாக்கப்பட்ட குறியீடுகளை பரிசீலிக்கவும்.",
    obsidianTitle: "Obsidian வால்ட்டின் {percent} இடத்தைப் பயன்படுத்துகிறது",
    obsidianDesc: "செருகுநிரல் தரவும் குறியீடுகளும் {size} பயன்படுத்துகின்றன. பொறுப்பான செருகுநிரல் அல்லது கேஷை கண்டறிய கோப்புறை தரவரிசையைத் திறக்கவும்.",
    copilotTitle: "Copilot குறியீட்டு கோப்புகள் {size} பயன்படுத்துகின்றன",
    copilotDesc: "இவை உருவாக்கப்பட்ட உள்ளூர் குறியீடுகள். அவற்றைப் பிரித்து மூன்றாம் தரப்பு ஒத்திசைவில் இருந்து விலக்க நினைக்கவும்.",
    attachmentsTitle: "இணைப்புகள் சேமிப்பகத்தை அதிகம் பயன்படுத்துகின்றன",
    attachmentsDesc: "{path} {size} ({percent}) பயன்படுத்துகிறது. சுருக்கம், காப்பகம் அல்லது தேர்ந்தெடுத்த ஒத்திசைவை பரிசீலிக்கவும்.",
    unreadableTitle: "{count} உருப்படிகளை வாசிக்க முடியவில்லை",
    unreadableDesc: "அனுமதிகள், தற்காலிக பூட்டுகள், முறிந்த இணைப்புகள் அல்லது கிடைக்காத மேகக் கோப்புகள் காரணமாக மொத்தம் முழுமையற்றதாக இருக்கலாம்.",
    about: "பற்றி",
    version: "பதிப்பு {version}",
    openStorageMap: "சேமிப்பக வரைபடத்தைத் திற",
    scanVaultStorage: "வால்ட் சேமிப்பகத்தை ஸ்கேன் செய்",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
  pt: {
    ...EN_TRANSLATIONS,
    pluginName: "Vault Storage Map",
    subtitle: "Análise visual do armazenamento",
    localReadOnly: "Local · Análise somente leitura · Sem envios",
    developedBy: "Desenvolvido por AIMETON · Dimar4713",
    scan: "Analisar cofre",
    rescan: "Analisar novamente",
    scanning: "Analisando…",
    cancel: "Cancelar",
    fastScanHint: "Cofres pequenos podem terminar antes de você conseguir pressionar Cancelar. Com este painel em foco, Esc também cancela a análise.",
    breadcrumbLabel: "Caminho das pastas",
    breadcrumbHelp: "Esta trilha de navegação mostra a pasta atual. Clique em qualquer segmento para voltar a esse nível.",
    search: "Pesquisar arquivos ou pastas…",
    allSizes: "Todos os tamanhos",
    over1mb: "Acima de 1 MB",
    over10mb: "Acima de 10 MB",
    over100mb: "Acima de 100 MB",
    summary: "Visão geral",
    treemap: "Mapa",
    folders: "Pastas",
    files: "Arquivos",
    fileTypes: "Tipos de arquivo",
    recommendations: "Recomendações",
    emptyTitle: "Veja o que ocupa seu cofre",
    emptyText: "Analise notas, anexos, dados de plugins, índices e pastas ocultas. Apenas metadados são lidos; nada é enviado ou excluído.",
    previousScan: "Análise anterior",
    scannedProgress: "{files} arquivos e {folders} pastas analisados",
    starting: "Iniciando…",
    totalSize: "Tamanho total",
    scanTime: "Tempo de análise",
    obsidianSize: "Tamanho de Obsidian",
    largestFolder: "Maior pasta",
    largestFile: "Maior arquivo",
    changeSinceLast: "Mudança desde a última análise",
    noPreviousComparison: "Execute outra análise para comparar o crescimento do armazenamento.",
    topFolders: "Maiores pastas",
    topFiles: "Maiores arquivos",
    scannedAt: "Analisado em {date}",
    unreadableEntries: "{count} itens ilegíveis",
    noData: "Sem dados.",
    noMatches: "Nenhum item corresponde aos filtros atuais.",
    path: "Caminho",
    size: "Tamanho",
    type: "Tipo",
    modified: "Modificado",
    actions: "Ações",
    percentVault: "% do cofre",
    reveal: "Mostrar no explorador de arquivos",
    copyPath: "Copiar caminho absoluto",
    copied: "Copiado.",
    open: "Abrir",
    drillDown: "Abrir pasta no mapa",
    storageByType: "Armazenamento por tipo de arquivo",
    details: "Detalhes",
    showDetails: "Mostrar detalhes",
    hideDetails: "Ocultar detalhes",
    selectItem: "Selecione um bloco do mapa ou uma linha da tabela.",
    itemKind: "Categoria",
    itemFiles: "Arquivos dentro",
    itemFolders: "Pastas dentro",
    shareVault: "Participação no cofre",
    shareParent: "Participação na pasta superior",
    diagnosticOnly: "As recomendações são apenas diagnósticas. O plugin nunca exclui, move ou ignora arquivos automaticamente.",
    noRisks: "Nenhum risco evidente foi detectado com os limites atuais.",
    copyRule: "Copiar regra de exclusão",
    exportMd: "Exportar Markdown",
    exportCsv: "Exportar CSV",
    exportJson: "Exportar JSON",
    exportCreated: "Relatório criado: {path}",
    exportFailed: "Falha na exportação: {error}",
    scanComplete: "Análise concluída: {size} em {files} arquivos.",
    scanCancelled: "Análise cancelada.",
    scanFailed: "Falha na análise: {error}",
    desktopRequired: "Vault Storage Map requer a versão para desktop e um caminho local do cofre.",
    cachedResult: "Mostrando análise em cache de {date}",
    cacheSkipped: "A análise é grande demais para armazenamento seguro em cache; os resultados continuam disponíveis.",
    cacheCleared: "Cache da análise limpo.",
    themeSystem: "Sistema",
    themeLight: "Claro",
    themeDark: "Escuro",
    languageAuto: "Automático",
    colorType: "Por tipo de arquivo",
    colorSize: "Por tamanho",
    colorDepth: "Por profundidade",
    settingsTitle: "Vault Storage Map",
    languageSetting: "Idioma da interface",
    languageDesc: "Automático segue o idioma do Obsidian ou do sistema operacional.",
    themeSetting: "Tema da interface",
    themeDesc: "Sistema segue o Obsidian. Claro e escuro alteram apenas o painel do plugin.",
    colorSetting: "Cores do mapa",
    colorDesc: "Escolha se a cor representa tipo de arquivo, tamanho relativo ou profundidade.",
    includeHidden: "Incluir arquivos e pastas ocultos",
    includeHiddenDesc: "Inclui nomes que começam com ponto. Recomendado para diagnóstico.",
    includeObsidian: "Incluir Obsidian",
    includeObsidianDesc: "Analisa dados de plugins, índices, caches e arquivos de configuração.",
    scanOnOpen: "Analisar ao abrir a visualização",
    scanOnOpenDesc: "Desativado por padrão para evitar atividade desnecessária no disco.",
    cacheLast: "Armazenar a última análise em cache",
    cacheLastDesc: "Mostra o resultado anterior instantaneamente. Somente caminhos, tamanhos, datas e contagens são armazenados localmente.",
    followLinks: "Seguir links simbólicos",
    followLinksDesc: "Mantenha desativado a menos que entenda o risco de analisar fora do cofre ou criar ciclos.",
    largeThreshold: "Limite de arquivo grande",
    largeThresholdDesc: "Arquivos deste tamanho ou maiores são destacados, em megabytes.",
    maxRows: "Máximo de linhas na tabela",
    maxRowsDesc: "Limita o número de pastas e arquivos exibidos nas tabelas.",
    exclusions: "Padrões de exclusão",
    exclusionsDesc: "Um padrão glob simples por linha, aplicado a caminhos relativos ao cofre.",
    clearCurrent: "Limpar resultado atual",
    clearCurrentDesc: "Limpa a visualização da memória. Nenhum arquivo do cofre é removido.",
    clearCache: "Limpar resultado em cache",
    clearCacheDesc: "Exclui somente o cache local de metadados do plugin.",
    clear: "Limpar",
    folder: "Pasta",
    file: "Arquivo",
    helpTreemap: "Clique para selecionar. Dê duplo clique em uma pasta para entrar ou em um arquivo para abrir. O botão direito mostra no explorador.",
    largeFilesTitle: "{count} arquivo(s) grande(s) detectado(s)",
    largeFilesDesc: "O maior é {path}, com {size}. Revise mídias, exportações e índices gerados antes de sincronizar.",
    obsidianTitle: "Obsidian ocupa {percent} do cofre",
    obsidianDesc: "Dados e índices de plugins usam {size}. Abra a classificação de pastas para identificar o plugin ou cache responsável.",
    copilotTitle: "Arquivos de índice do Copilot usam {size}",
    copilotDesc: "São índices locais derivados. Considere particioná-los e excluí-los da sincronização de terceiros.",
    attachmentsTitle: "Anexos dominam o armazenamento",
    attachmentsDesc: "{path} usa {size} ({percent}). Considere compactação, arquivamento ou sincronização seletiva.",
    unreadableTitle: "Não foi possível ler {count} itens",
    unreadableDesc: "Os totais podem estar incompletos por permissões, bloqueios temporários, links quebrados ou arquivos de nuvem indisponíveis.",
    about: "Sobre",
    version: "Versão {version}",
    openStorageMap: "Abrir mapa de armazenamento",
    scanVaultStorage: "Analisar armazenamento do cofre",
    languageRussian: "Русский",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageFrench: "Français",
    languageGerman: "Deutsch",
    languageSpanish: "Español",
    languageItalian: "Italiano",
    languageTurkish: "Türkçe",
    languageHindi: "हिन्दी",
    languageBengali: "বাংলা",
    languageTamil: "தமிழ்",
    languagePortuguese: "Português",
  },
};
class ScanCancelledError extends Error {
  constructor() {
    super("Scan cancelled");
    this.name = "ScanCancelledError";
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async use<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

class VaultScanner {
  private readonly errors: ScanError[] = [];
  private readonly extensionMap = new Map<string, ExtensionStat>();
  private readonly progress: ScanProgress = { filesScanned: 0, foldersScanned: 0, bytesScanned: 0, currentPath: "" };
  private readonly semaphore = new Semaphore(16);
  private readonly visitedDirectories = new Set<string>();
  private lastProgressEmit = 0;
  private readonly excludeMatchers: RegExp[];

  constructor(
    private readonly rootPath: string,
    private readonly settings: VaultStorageMapSettings,
    private readonly configDir: string,
    private readonly signal: AbortSignal,
    private readonly onProgress: (progress: ScanProgress) => void,
  ) {
    this.excludeMatchers = settings.excludePatterns
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(globToRegExp);
  }

  async scan(): Promise<ScanResult> {
    const startedAt = performance.now();
    const rootName = basename(this.rootPath) || this.rootPath;
    const root = await this.scanDirectory(this.rootPath, "", rootName);
    this.emitProgress(true);
    return {
      root,
      generatedAt: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      extensions: [...this.extensionMap.values()].sort((a, b) => b.size - a.size),
      errors: this.errors,
    };
  }

  private checkCancelled(): void {
    if (this.signal.aborted) throw new ScanCancelledError();
  }

  private shouldSkip(name: string, relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    const normalizedConfigDir = this.configDir.replace(/\\/g, "/");
    const internalCachePath = `${normalizedConfigDir}/plugins/vault-storage-map/storage-cache-v1.json`;
    if (normalized === internalCachePath) return true;
    if (!this.settings.includeHidden && name.startsWith(".")) return true;
    if (!this.settings.includeObsidianConfig && (normalized === normalizedConfigDir || normalized.startsWith(`${normalizedConfigDir}/`))) return true;
    return this.excludeMatchers.some((matcher) => matcher.test(normalized));
  }

  private async scanDirectory(absolutePath: string, relativePath: string, name: string): Promise<StorageNode> {
    this.checkCancelled();
    if (this.settings.followSymbolicLinks) {
      try {
        const realPath = await this.semaphore.use(() => realpath(absolutePath));
        if (this.visitedDirectories.has(realPath)) {
          this.errors.push({ relativePath: relativePath || ".", message: "Symbolic-link loop or duplicate target skipped" });
          return { name, relativePath, absolutePath, kind: "folder", size: 0, fileCount: 0, folderCount: 0, children: [] };
        }
        this.visitedDirectories.add(realPath);
      } catch (error) {
        this.errors.push({ relativePath: relativePath || ".", message: errorMessage(error) });
      }
    }

    this.progress.foldersScanned += 1;
    this.progress.currentPath = relativePath || name;
    this.emitProgress();

    let entries: Dirent[];
    try {
      entries = await this.semaphore.use(() => readdir(absolutePath, { withFileTypes: true }));
    } catch (error) {
      this.errors.push({ relativePath: relativePath || ".", message: errorMessage(error) });
      return { name, relativePath, absolutePath, kind: "folder", size: 0, fileCount: 0, folderCount: 0, children: [] };
    }

    const children = (
      await Promise.all(
        entries.map(async (entry): Promise<StorageNode | null> => {
          this.checkCancelled();
          const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          if (this.shouldSkip(entry.name, childRelative)) return null;
          const childAbsolute = join(absolutePath, entry.name);

          if (entry.isSymbolicLink()) {
            if (!this.settings.followSymbolicLinks) return null;
            try {
              const linkedStat = await this.semaphore.use(() => fsStat(childAbsolute));
              if (linkedStat.isDirectory()) return this.scanDirectory(childAbsolute, childRelative, entry.name);
              if (linkedStat.isFile()) return this.scanFile(childAbsolute, childRelative, entry.name);
              return null;
            } catch (error) {
              this.errors.push({ relativePath: childRelative, message: errorMessage(error) });
              return null;
            }
          }
          if (entry.isDirectory()) return this.scanDirectory(childAbsolute, childRelative, entry.name);
          if (!entry.isFile()) return null;
          return this.scanFile(childAbsolute, childRelative, entry.name);
        }),
      )
    ).filter((node): node is StorageNode => node !== null);

    children.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    return {
      name,
      relativePath,
      absolutePath,
      kind: "folder",
      size: children.reduce((sum, child) => sum + child.size, 0),
      fileCount: children.reduce((sum, child) => sum + child.fileCount, 0),
      folderCount: children.reduce((sum, child) => sum + child.folderCount + (child.kind === "folder" ? 1 : 0), 0),
      children,
    };
  }

  private async scanFile(absolutePath: string, relativePath: string, name: string): Promise<StorageNode | null> {
    this.checkCancelled();
    try {
      const stat = await this.semaphore.use(() => fsStat(absolutePath));
      if (!stat.isFile()) return null;
      const extension = fileExtension(name);
      this.progress.filesScanned += 1;
      this.progress.bytesScanned += stat.size;
      this.progress.currentPath = relativePath;
      this.updateExtension(extension, stat.size);
      this.emitProgress();
      return {
        name,
        relativePath,
        absolutePath,
        kind: "file",
        size: stat.size,
        fileCount: 1,
        folderCount: 0,
        modifiedAt: stat.mtimeMs,
        extension,
      };
    } catch (error) {
      this.errors.push({ relativePath, message: errorMessage(error) });
      return null;
    }
  }

  private updateExtension(extension: string, size: number): void {
    const current = this.extensionMap.get(extension) ?? { extension, size: 0, fileCount: 0 };
    current.size += size;
    current.fileCount += 1;
    this.extensionMap.set(extension, current);
  }

  private emitProgress(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastProgressEmit < 100) return;
    this.lastProgressEmit = now;
    this.onProgress({ ...this.progress });
  }
}

export default class VaultStorageMapPlugin extends Plugin {
  settings: VaultStorageMapSettings = DEFAULT_SETTINGS;
  scanResult: ScanResult | null = null;
  scanProgress: ScanProgress | null = null;
  scanController: AbortController | null = null;
  scanPromise: Promise<ScanResult | null> | null = null;
  loadedFromCache = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (this.settings.cacheLastScan) await this.loadCachedResult();

    this.registerView(VIEW_TYPE_STORAGE_MAP, (leaf) => new StorageMapView(leaf, this));
    this.addRibbonIcon("hard-drive", this.t("pluginName"), () => void this.activateView());
    this.addCommand({ id: "open-storage-map", name: this.t("openStorageMap"), callback: () => void this.activateView() });
    this.addCommand({
      id: "scan-storage",
      name: this.t("scanVaultStorage"),
      callback: async () => {
        await this.activateView();
        await this.startScan();
      },
    });
    this.addSettingTab(new VaultStorageMapSettingTab(this.app, this));
  }

  onunload(): void {
    this.scanController?.abort();
  }

  resolveLanguage(): ResolvedLanguage {
    if (this.settings.language !== "auto") return this.settings.language;
    const candidate = (navigator.language || "en").toLowerCase();
    if (candidate.startsWith("ru")) return "ru";
    if (candidate.startsWith("zh")) return "zh-cn";
    if (candidate.startsWith("fr")) return "fr";
    if (candidate.startsWith("de")) return "de";
    if (candidate.startsWith("es")) return "es";
    if (candidate.startsWith("it")) return "it";
    if (candidate.startsWith("tr")) return "tr";
    if (candidate.startsWith("hi")) return "hi";
    if (candidate.startsWith("bn")) return "bn";
    if (candidate.startsWith("ta")) return "ta";
    if (candidate.startsWith("pt")) return "pt";
    return "en";
  }

  t(key: string, vars: Record<string, string | number> = {}): string {
    const language = this.resolveLanguage();
    let value = I18N[language][key] ?? I18N.en[key] ?? key;
    for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<VaultStorageMapSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STORAGE_MAP)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_STORAGE_MAP, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async startScan(): Promise<ScanResult | null> {
    if (this.scanPromise) return this.scanPromise;
    const basePath = this.getVaultBasePath();
    if (!basePath) {
      new Notice(this.t("desktopRequired"));
      return null;
    }

    this.scanController = new AbortController();
    this.scanProgress = { filesScanned: 0, foldersScanned: 0, bytesScanned: 0, currentPath: "" };
    this.loadedFromCache = false;
    this.refreshViews();

    const scanner = new VaultScanner(basePath, this.settings, this.app.vault.configDir, this.scanController.signal, (progress) => {
      this.scanProgress = progress;
      this.refreshViews();
    });

    this.scanPromise = (async () => {
      try {
        const result = await scanner.scan();
        const oldSummary = this.settings.lastSummary;
        this.scanResult = result;
        this.settings.previousSummary = oldSummary;
        this.settings.lastSummary = createStoredSummary(result);
        await this.saveSettings();
        if (this.settings.cacheLastScan) await this.saveCachedResult(result);
        else await this.clearCachedResult();
        new Notice(this.t("scanComplete", { size: formatBytes(result.root.size), files: result.root.fileCount }));
        return result;
      } catch (error) {
        if (error instanceof ScanCancelledError) {
          new Notice(this.t("scanCancelled"));
          return null;
        }
        console.error("Vault Storage Map scan failed", error);
        new Notice(this.t("scanFailed", { error: errorMessage(error) }));
        return null;
      } finally {
        this.scanPromise = null;
        this.scanController = null;
        this.scanProgress = null;
        this.refreshViews();
      }
    })();

    return this.scanPromise;
  }

  cancelScan(): void {
    this.scanController?.abort();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STORAGE_MAP)) {
      const view = leaf.view;
      if (view instanceof StorageMapView) view.render();
    }
  }

  getVaultBasePath(): string | null {
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
  }

  getCachePath(): string | null {
    const base = this.getVaultBasePath();
    if (!base) return null;
    return join(base, this.app.vault.configDir, "plugins", this.manifest.id, "storage-cache-v1.json");
  }

  async loadCachedResult(): Promise<void> {
    const cachePath = this.getCachePath();
    const basePath = this.getVaultBasePath();
    if (!cachePath || !basePath) return;
    try {
      const raw = await readFile(cachePath, "utf8");
      const cached = JSON.parse(raw) as CachedScanResult;
      if (cached.cacheVersion !== CACHE_VERSION || !cached.root) return;
      this.scanResult = {
        root: hydrateNode(cached.root, basePath),
        generatedAt: cached.generatedAt,
        durationMs: cached.durationMs,
        extensions: cached.extensions ?? [],
        errors: cached.errors ?? [],
      };
      this.loadedFromCache = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Vault Storage Map cache load failed", error);
    }
  }

  async saveCachedResult(result: ScanResult): Promise<void> {
    const cachePath = this.getCachePath();
    if (!cachePath) return;
    if (countNodes(result.root) > MAX_CACHED_NODES) {
      new Notice(this.t("cacheSkipped"));
      return;
    }
    const cached: CachedScanResult = {
      cacheVersion: CACHE_VERSION,
      root: dehydrateNode(result.root),
      generatedAt: result.generatedAt,
      durationMs: result.durationMs,
      extensions: result.extensions,
      errors: result.errors,
    };
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(cached), "utf8");
    } catch (error) {
      console.warn("Vault Storage Map cache save failed", error);
    }
  }

  async clearCachedResult(): Promise<void> {
    const cachePath = this.getCachePath();
    if (!cachePath) return;
    try {
      await rm(cachePath, { force: true });
    } catch (error) {
      console.warn("Vault Storage Map cache clear failed", error);
    }
  }

  async exportReport(format: ExportFormat): Promise<void> {
    const result = this.scanResult;
    if (!result) return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const extension = format === "md" ? "md" : format;
      const filePath = uniqueVaultPath(this.app, `Vault Storage Report ${stamp}.${extension}`);
      let content = "";
      if (format === "md") content = buildMarkdownReport(result, this);
      if (format === "csv") content = buildCsvReport(result);
      if (format === "json") content = JSON.stringify(buildPortableReport(result), null, 2);
      await this.app.vault.create(filePath, content);
      new Notice(this.t("exportCreated", { path: filePath }));
      const created = this.app.vault.getFileByPath(filePath);
      if (created) await this.app.workspace.getLeaf("tab").openFile(created);
    } catch (error) {
      new Notice(this.t("exportFailed", { error: errorMessage(error) }));
    }
  }
}

class StorageMapView extends ItemView {
  private activeTab: ViewTab = "summary";
  private treemapPath = "";
  private selectedPath = "";
  private searchQuery = "";
  private minimumSize = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: VaultStorageMapPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STORAGE_MAP;
  }

  getDisplayText(): string {
    return this.plugin.t("pluginName");
  }

  getIcon(): string {
    return "hard-drive";
  }

  async onOpen(): Promise<void> {
    const activeDocument = this.containerEl.ownerDocument;
    this.registerDomEvent(activeDocument, "keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.plugin.scanPromise) return;
      if (!this.containerEl.contains(activeDocument.activeElement)) return;
      event.preventDefault();
      this.plugin.cancelScan();
    });
    this.render();
    if (this.plugin.settings.scanOnViewOpen && !this.plugin.scanResult && !this.plugin.scanPromise) await this.plugin.startScan();
  }

  async onClose(): Promise<void> {}

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.className = "view-content vsm-view";
    container.addClass(`vsm-theme-${this.plugin.settings.theme}`);
    container.setAttribute("lang", this.plugin.resolveLanguage());

    this.renderHeader(container);
    if (this.plugin.scanProgress) this.renderProgress(container, this.plugin.scanProgress);

    if (!this.plugin.scanResult) {
      this.renderEmptyState(container);
      this.renderFooter(container);
      return;
    }

    if (this.plugin.loadedFromCache) {
      container.createDiv({ cls: "vsm-cache-banner", text: this.plugin.t("cachedResult", { date: formatDate(this.plugin.scanResult.generatedAt, this.plugin.resolveLanguage()) }) });
    }

    this.renderTabs(container);
    const selected = this.selectedPath ? findNode(this.plugin.scanResult.root, this.selectedPath) : null;
    const layout = container.createDiv({ cls: "vsm-content-layout" });
    if (!selected) layout.addClass("is-details-hidden");
    else if (this.plugin.settings.detailsPanelCollapsed) layout.addClass("is-details-collapsed");
    const panel = layout.createDiv({ cls: "vsm-panel" });
    switch (this.activeTab) {
      case "summary": this.renderSummary(panel, this.plugin.scanResult); break;
      case "treemap": this.renderTreemap(panel, this.plugin.scanResult); break;
      case "folders": this.renderFolders(panel, this.plugin.scanResult); break;
      case "files": this.renderFiles(panel, this.plugin.scanResult); break;
      case "types": this.renderTypes(panel, this.plugin.scanResult); break;
      case "recommendations": this.renderRecommendations(panel, this.plugin.scanResult); break;
    }
    if (selected) this.renderDetails(layout, this.plugin.scanResult, selected);
    this.renderFooter(container);
  }

  private renderHeader(container: HTMLElement): void {
    const hero = container.createDiv({ cls: "vsm-hero" });
    const brand = hero.createDiv({ cls: "vsm-brand" });
    const logo = brand.createDiv({ cls: "vsm-logo" });
    setIcon(logo, "pie-chart");
    const titleWrap = brand.createDiv({ cls: "vsm-title-wrap" });
    titleWrap.createEl("h2", { text: this.plugin.t("pluginName") });
    titleWrap.createDiv({ cls: "vsm-subtitle", text: this.plugin.t("subtitle") });
    titleWrap.createDiv({ cls: "vsm-brandline", text: this.plugin.t("developedBy") });

    const actions = hero.createDiv({ cls: "vsm-actions" });
    const scanButton = actions.createEl("button", {
      cls: "mod-cta vsm-scan-button",
      text: this.plugin.scanPromise ? this.plugin.t("scanning") : this.plugin.scanResult ? this.plugin.t("rescan") : this.plugin.t("scan"),
    });
    scanButton.disabled = Boolean(this.plugin.scanPromise);
    scanButton.addEventListener("click", () => void this.plugin.startScan());
    if (this.plugin.scanPromise) {
      const cancelButton = actions.createEl("button", { text: this.plugin.t("cancel") });
      cancelButton.addEventListener("click", () => this.plugin.cancelScan());
    }

    if (this.plugin.scanResult) {
      const toolbar = container.createDiv({ cls: "vsm-toolbar" });
      const searchWrap = toolbar.createDiv({ cls: "vsm-search-wrap" });
      setIcon(searchWrap.createSpan({ cls: "vsm-search-icon" }), "search");
      const search = searchWrap.createEl("input", { type: "search", placeholder: this.plugin.t("search") });
      search.value = this.searchQuery;
      search.addEventListener("input", () => {
        const caret = search.selectionStart ?? search.value.length;
        this.searchQuery = search.value.trim().toLocaleLowerCase();
        this.render();
        window.requestAnimationFrame(() => {
          const next = this.containerEl.querySelector<HTMLInputElement>(".vsm-search-wrap input");
          if (!next) return;
          next.focus();
          next.setSelectionRange(Math.min(caret, next.value.length), Math.min(caret, next.value.length));
        });
      });
      const sizeSelect = toolbar.createEl("select", { cls: "vsm-size-filter" });
      const options: Array<[number, string]> = [[0, "allSizes"], [1, "over1mb"], [10, "over10mb"], [100, "over100mb"]];
      for (const [value, key] of options) sizeSelect.createEl("option", { value: String(value), text: this.plugin.t(key) });
      sizeSelect.value = String(this.minimumSize / 1024 / 1024);
      sizeSelect.addEventListener("change", () => {
        this.minimumSize = Number(sizeSelect.value) * 1024 * 1024;
        this.render();
      });
    }
  }

  private renderProgress(container: HTMLElement, progress: ScanProgress): void {
    const progressBox = container.createDiv({ cls: "vsm-progress" });
    const row = progressBox.createDiv({ cls: "vsm-progress-row" });
    row.createSpan({ text: this.plugin.t("scannedProgress", { files: progress.filesScanned.toLocaleString(), folders: progress.foldersScanned.toLocaleString() }) });
    row.createSpan({ text: formatBytes(progress.bytesScanned) });
    progressBox.createDiv({ cls: "vsm-progress-path", text: progress.currentPath || this.plugin.t("starting") });
    progressBox.createDiv({ cls: "vsm-progress-indeterminate" }).createDiv();
    progressBox.createDiv({ cls: "vsm-progress-hint", text: this.plugin.t("fastScanHint") });
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "vsm-empty" });
    const icon = empty.createDiv({ cls: "vsm-empty-icon" });
    setIcon(icon, "pie-chart");
    empty.createEl("h3", { text: this.plugin.t("emptyTitle") });
    empty.createEl("p", { text: this.plugin.t("emptyText") });
    const button = empty.createEl("button", { cls: "mod-cta", text: this.plugin.t("scan") });
    button.addEventListener("click", () => void this.plugin.startScan());
    if (this.plugin.settings.lastSummary) {
      const previous = this.plugin.settings.lastSummary;
      empty.createDiv({
        cls: "vsm-last-summary",
        text: `${this.plugin.t("previousScan")}: ${formatBytes(previous.totalSize)}, ${previous.fileCount.toLocaleString()} — ${formatDate(previous.generatedAt, this.plugin.resolveLanguage())}`,
      });
    }
  }

  private renderTabs(container: HTMLElement): void {
    const tabs: Array<[ViewTab, string, string]> = [
      ["summary", "summary", "layout-dashboard"],
      ["treemap", "treemap", "panels-top-left"],
      ["folders", "folders", "folder-tree"],
      ["files", "files", "files"],
      ["types", "fileTypes", "chart-no-axes-column"],
      ["recommendations", "recommendations", "lightbulb"],
    ];
    const tabBar = container.createDiv({ cls: "vsm-tabs" });
    for (const [id, key, iconName] of tabs) {
      const button = tabBar.createEl("button", { cls: this.activeTab === id ? "is-active" : "" });
      setIcon(button.createSpan({ cls: "vsm-tab-icon" }), iconName);
      button.createSpan({ text: this.plugin.t(key) });
      button.addEventListener("click", () => {
        this.activeTab = id;
        this.render();
      });
    }
  }

  private renderSummary(container: HTMLElement, result: ScanResult): void {
    const files = flattenNodes(result.root, "file").sort((a, b) => b.size - a.size);
    const folders = flattenNodes(result.root, "folder").filter((node) => node.relativePath).sort((a, b) => b.size - a.size);
    const obsidianFolder = folders.find((node) => node.relativePath === this.app.vault.configDir);
    const cards = container.createDiv({ cls: "vsm-cards" });
    addMetricCard(cards, this.plugin.t("totalSize"), formatBytes(result.root.size), "hard-drive", storageDelta(result.root.size, this.plugin.settings.previousSummary?.totalSize));
    addMetricCard(cards, this.plugin.t("files"), result.root.fileCount.toLocaleString(), "files");
    addMetricCard(cards, this.plugin.t("folders"), result.root.folderCount.toLocaleString(), "folder-tree");
    addMetricCard(cards, this.plugin.t("scanTime"), formatDuration(result.durationMs), "timer");
    addMetricCard(cards, this.plugin.t("obsidianSize"), formatBytes(obsidianFolder?.size ?? 0), "settings");
    addMetricCard(cards, this.plugin.t("largestFile"), files[0] ? formatBytes(files[0].size) : "—", "file-warning", files[0]?.relativePath);

    const compare = container.createDiv({ cls: "vsm-section vsm-comparison" });
    compare.createEl("h3", { text: this.plugin.t("changeSinceLast") });
    this.renderComparison(compare, result, folders);

    const twoColumn = container.createDiv({ cls: "vsm-two-column" });
    const folderPanel = twoColumn.createDiv({ cls: "vsm-section" });
    folderPanel.createEl("h3", { text: this.plugin.t("topFolders") });
    this.renderRanking(folderPanel, folders.slice(0, 8), result.root.size, "folder");
    const filePanel = twoColumn.createDiv({ cls: "vsm-section" });
    filePanel.createEl("h3", { text: this.plugin.t("topFiles") });
    this.renderRanking(filePanel, files.slice(0, 8), result.root.size, "file");

    const exportSection = container.createDiv({ cls: "vsm-export-row" });
    for (const [format, key, icon] of [["md", "exportMd", "file-text"], ["csv", "exportCsv", "table"], ["json", "exportJson", "braces"]] as Array<[ExportFormat, string, string]>) {
      const button = exportSection.createEl("button");
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: this.plugin.t(key) });
      button.addEventListener("click", () => void this.plugin.exportReport(format));
    }

    const footer = container.createDiv({ cls: "vsm-scan-meta" });
    footer.createSpan({ text: this.plugin.t("scannedAt", { date: formatDate(result.generatedAt, this.plugin.resolveLanguage()) }) });
    if (result.errors.length) footer.createSpan({ text: this.plugin.t("unreadableEntries", { count: result.errors.length }), cls: "vsm-warning-text" });
  }

  private renderComparison(container: HTMLElement, result: ScanResult, folders: StorageNode[]): void {
    const previous = this.plugin.settings.previousSummary;
    if (!previous) {
      container.createEl("p", { cls: "vsm-help-text", text: this.plugin.t("noPreviousComparison") });
      return;
    }
    const totalDelta = result.root.size - previous.totalSize;
    const summary = container.createDiv({ cls: `vsm-delta-summary ${totalDelta > 0 ? "is-growth" : totalDelta < 0 ? "is-shrink" : ""}` });
    summary.createSpan({ text: `${totalDelta > 0 ? "+" : ""}${formatBytesSigned(totalDelta)}` });
    summary.createSpan({ text: `${previous.fileCount.toLocaleString()} → ${result.root.fileCount.toLocaleString()} ${this.plugin.t("files").toLocaleLowerCase()}` });

    const changed = folders
      .map((folder) => ({ folder, delta: folder.size - (previous.folderSizes?.[folder.relativePath] ?? 0) }))
      .filter((item) => item.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 6);
    if (!changed.length) return;
    const list = container.createDiv({ cls: "vsm-change-list" });
    for (const item of changed) {
      const row = list.createDiv({ cls: "vsm-change-row" });
      row.createSpan({ cls: "vsm-change-path", text: item.folder.relativePath });
      row.createSpan({ cls: item.delta > 0 ? "is-growth" : "is-shrink", text: `${item.delta > 0 ? "+" : ""}${formatBytesSigned(item.delta)}` });
    }
  }

  private renderRanking(container: HTMLElement, nodes: StorageNode[], totalSize: number, kind: NodeKind): void {
    const filtered = this.filterNodes(nodes);
    if (!filtered.length) {
      container.createEl("p", { text: this.plugin.t("noMatches") });
      return;
    }
    for (const node of filtered) {
      const item = container.createDiv({ cls: "vsm-ranking-item" });
      const textRow = item.createDiv({ cls: "vsm-ranking-text" });
      const name = textRow.createSpan({ cls: "vsm-ranking-name", text: node.relativePath || node.name });
      name.title = node.absolutePath;
      textRow.createSpan({ cls: "vsm-ranking-size", text: formatBytes(node.size) });
      const bar = item.createDiv({ cls: "vsm-bar" });
      const fill = bar.createDiv({ cls: `vsm-bar-fill is-${kind}` });
      fill.style.width = `${Math.max(1, Math.min(100, (node.size / Math.max(totalSize, 1)) * 100))}%`;
      item.addEventListener("click", () => this.selectNode(node));
      item.addEventListener("dblclick", () => this.openNode(node));
    }
  }

  private renderTreemap(container: HTMLElement, result: ScanResult): void {
    let current = findNode(result.root, this.treemapPath) ?? result.root;
    if (current.kind === "file") current = result.root;
    const header = container.createDiv({ cls: "vsm-treemap-header" });
    const breadcrumbArea = header.createDiv({ cls: "vsm-breadcrumb-area" });
    const breadcrumbTitle = breadcrumbArea.createDiv({ cls: "vsm-breadcrumb-title" });
    breadcrumbTitle.createSpan({ cls: "vsm-breadcrumb-label", text: this.plugin.t("breadcrumbLabel") });
    const breadcrumbHelpWrap = breadcrumbTitle.createSpan({ cls: "vsm-breadcrumb-help-wrap" });
    const breadcrumbHelp = breadcrumbHelpWrap.createEl("button", {
      cls: "vsm-breadcrumb-help",
      attr: { type: "button", "aria-expanded": "false" },
    });
    setIcon(breadcrumbHelp, "circle-help");
    breadcrumbHelp.createSpan({ cls: "vsm-sr-only", text: this.plugin.t("breadcrumbHelp") });
    const breadcrumbPopover = breadcrumbHelpWrap.createDiv({
      cls: "vsm-breadcrumb-popover",
      text: this.plugin.t("breadcrumbHelp"),
    });
    const popoverId = `vsm-breadcrumb-help-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    breadcrumbPopover.id = popoverId;
    breadcrumbHelp.setAttribute("aria-controls", popoverId);

    let helpPinned = false;
    const positionHelpPopover = (): void => {
      breadcrumbPopover.style.removeProperty("--vsm-popover-shift-x");
      breadcrumbPopover.style.removeProperty("--vsm-popover-arrow-x");

      const viewBoundary = container.closest(".vsm-view")?.getBoundingClientRect();
      const boundary = viewBoundary ?? { left: 0, right: window.innerWidth };
      const popoverRect = breadcrumbPopover.getBoundingClientRect();
      const buttonRect = breadcrumbHelp.getBoundingClientRect();
      const edgePadding = 10;
      let shiftX = 0;

      if (popoverRect.left < boundary.left + edgePadding) {
        shiftX += boundary.left + edgePadding - popoverRect.left;
      }
      if (popoverRect.right + shiftX > boundary.right - edgePadding) {
        shiftX -= popoverRect.right + shiftX - (boundary.right - edgePadding);
      }

      const shiftedLeft = popoverRect.left + shiftX;
      const arrowX = Math.max(12, Math.min(popoverRect.width - 12, buttonRect.left + buttonRect.width / 2 - shiftedLeft));
      breadcrumbPopover.style.setProperty("--vsm-popover-shift-x", `${shiftX}px`);
      breadcrumbPopover.style.setProperty("--vsm-popover-arrow-x", `${arrowX}px`);
    };
    const setHelpOpen = (open: boolean): void => {
      breadcrumbHelpWrap.toggleClass("is-open", open);
      breadcrumbHelp.setAttribute("aria-expanded", String(open));
      if (open) window.requestAnimationFrame(positionHelpPopover);
    };
    breadcrumbHelp.addEventListener("mouseenter", () => setHelpOpen(true));
    breadcrumbHelp.addEventListener("mouseleave", () => {
      if (!helpPinned) setHelpOpen(false);
    });
    breadcrumbHelp.addEventListener("focus", () => setHelpOpen(true));
    breadcrumbHelp.addEventListener("blur", () => {
      helpPinned = false;
      setHelpOpen(false);
    });
    breadcrumbHelp.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      helpPinned = !helpPinned;
      setHelpOpen(helpPinned);
    });
    breadcrumbHelp.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      helpPinned = false;
      setHelpOpen(false);
      breadcrumbHelp.blur();
    });
    const breadcrumb = breadcrumbArea.createDiv({ cls: "vsm-breadcrumb" });
    this.renderBreadcrumb(breadcrumb, result.root, current);
    header.createDiv({ cls: "vsm-treemap-meta", text: `${formatBytes(current.size)} · ${current.fileCount.toLocaleString()} ${this.plugin.t("files").toLocaleLowerCase()}` });

    const treemap = container.createDiv({ cls: "vsm-treemap", attr: { role: "img", "aria-label": this.plugin.t("treemap") } });
    const sourceNodes = this.searchQuery
      ? flattenNodes(current).filter((node) => node !== current && node.size > 0)
      : (current.children ?? []).filter((node) => node.size > 0);
    const children = this.filterNodes(sourceNodes).slice(0, 500);
    if (!children.length) {
      treemap.createDiv({ cls: "vsm-empty-inline", text: this.plugin.t("noMatches") });
      return;
    }

    window.requestAnimationFrame(() => {
      if (!treemap.isConnected) return;
      const width = Math.max(320, treemap.clientWidth);
      const height = Math.max(440, treemap.clientHeight);
      const rects = binaryTreemap(children, 0, 0, width, height, 0);
      for (const rect of rects) {
        const block = treemap.createDiv({ cls: `vsm-treemap-node is-${rect.node.kind}${this.selectedPath === rect.node.relativePath ? " is-selected" : ""}` });
        block.style.left = `${rect.x}px`;
        block.style.top = `${rect.y}px`;
        block.style.width = `${Math.max(0, rect.width - 3)}px`;
        block.style.height = `${Math.max(0, rect.height - 3)}px`;
        block.style.background = treemapColor(rect.node, this.plugin.settings.treemapColorMode, rect.depth, rect.node.size / Math.max(current.size, 1));
        block.title = `${rect.node.relativePath || rect.node.name}\n${formatBytes(rect.node.size)} (${formatPercent(rect.node.size, current.size)})`;
        if (rect.width > 76 && rect.height > 36) {
          block.createDiv({ cls: "vsm-treemap-name", text: rect.node.name });
          block.createDiv({ cls: "vsm-treemap-size", text: formatBytes(rect.node.size) });
        }
        block.addEventListener("click", () => this.selectNode(rect.node));
        block.addEventListener("dblclick", () => {
          if (rect.node.kind === "folder") {
            this.treemapPath = rect.node.relativePath;
            this.selectedPath = rect.node.relativePath;
            this.render();
          } else this.openNode(rect.node);
        });
        block.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          electronShell.showItemInFolder(rect.node.absolutePath);
        });
      }
    });
    container.createEl("p", { cls: "vsm-help-text", text: this.plugin.t("helpTreemap") });
  }

  private renderBreadcrumb(container: HTMLElement, root: StorageNode, current: StorageNode): void {
    const rootButton = container.createEl("button", { text: root.name, cls: "vsm-breadcrumb-button" });
    rootButton.addEventListener("click", () => {
      this.treemapPath = "";
      this.render();
    });
    if (!current.relativePath) return;
    let accumulated = "";
    for (const segment of current.relativePath.split("/")) {
      container.createSpan({ text: "/", cls: "vsm-breadcrumb-separator" });
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      const target = accumulated;
      const button = container.createEl("button", { text: segment, cls: "vsm-breadcrumb-button" });
      button.addEventListener("click", () => {
        this.treemapPath = target;
        this.render();
      });
    }
  }

  private renderFolders(container: HTMLElement, result: ScanResult): void {
    const folders = this.filterNodes(flattenNodes(result.root, "folder").filter((node) => node.relativePath).sort((a, b) => b.size - a.size)).slice(0, this.plugin.settings.maxTableRows);
    container.createEl("h3", { text: `${this.plugin.t("topFolders")} (${folders.length})` });
    this.renderNodeTable(container, folders, true);
  }

  private renderFiles(container: HTMLElement, result: ScanResult): void {
    const files = this.filterNodes(flattenNodes(result.root, "file").sort((a, b) => b.size - a.size)).slice(0, this.plugin.settings.maxTableRows);
    container.createEl("h3", { text: `${this.plugin.t("topFiles")} (${files.length})` });
    this.renderNodeTable(container, files, false);
  }

  private renderNodeTable(container: HTMLElement, nodes: StorageNode[], folders: boolean): void {
    if (!nodes.length) {
      container.createEl("p", { text: this.plugin.t("noMatches") });
      return;
    }
    const wrapper = container.createDiv({ cls: "vsm-table-wrapper" });
    const table = wrapper.createEl("table", { cls: `vsm-table ${folders ? "is-folder-table" : "is-file-table"}` });
    const columnClasses = folders
      ? ["vsm-col-path", "vsm-col-size", "vsm-col-files", "vsm-col-percent", "vsm-col-actions"]
      : ["vsm-col-path", "vsm-col-type", "vsm-col-size", "vsm-col-modified", "vsm-col-actions"];
    const colgroup = table.createEl("colgroup");
    for (const columnClass of columnClasses) colgroup.createEl("col", { cls: columnClass });

    const header = table.createEl("thead").createEl("tr");
    const titles = folders
      ? [this.plugin.t("path"), this.plugin.t("size"), this.plugin.t("files"), this.plugin.t("percentVault"), this.plugin.t("actions")]
      : [this.plugin.t("path"), this.plugin.t("type"), this.plugin.t("size"), this.plugin.t("modified"), this.plugin.t("actions")];
    titles.forEach((title, index) => header.createEl("th", { text: title, cls: columnClasses[index] }));

    const body = table.createEl("tbody");
    const total = this.plugin.scanResult?.root.size ?? 1;
    for (const node of nodes) {
      const row = body.createEl("tr", { cls: this.selectedPath === node.relativePath ? "is-selected" : "" });
      row.addEventListener("click", () => this.selectNode(node));
      const pathCell = row.createEl("td", { cls: "vsm-col-path" });
      const pathButton = pathCell.createEl("button", { cls: "vsm-link-button", text: node.relativePath || node.name });
      pathButton.title = node.absolutePath;
      pathButton.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.openNode(node);
      });
      if (folders) {
        row.createEl("td", { cls: "vsm-col-size", text: formatBytes(node.size) });
        row.createEl("td", { cls: "vsm-col-files", text: node.fileCount.toLocaleString() });
        row.createEl("td", { cls: "vsm-col-percent", text: formatPercent(node.size, total) });
      } else {
        row.createEl("td", { cls: "vsm-col-type", text: node.extension || "—" });
        row.createEl("td", { cls: "vsm-col-size", text: formatBytes(node.size) });
        row.createEl("td", { cls: "vsm-col-modified", text: node.modifiedAt ? formatDate(node.modifiedAt, this.plugin.resolveLanguage()) : "—" });
      }
      const actions = row.createEl("td", { cls: "vsm-table-actions vsm-col-actions" });
      addIconButton(actions, "folder-open", this.plugin.t("reveal"), () => electronShell.showItemInFolder(node.absolutePath));
      addIconButton(actions, "copy", this.plugin.t("copyPath"), () => {
        void navigator.clipboard.writeText(node.absolutePath);
        new Notice(this.plugin.t("copied"));
      });
    }
  }

  private renderTypes(container: HTMLElement, result: ScanResult): void {
    container.createEl("h3", { text: this.plugin.t("storageByType") });
    const stats = result.extensions.filter((stat) => stat.size >= this.minimumSize && (!this.searchQuery || stat.extension.toLocaleLowerCase().includes(this.searchQuery)));
    if (!stats.length) {
      container.createEl("p", { text: this.plugin.t("noMatches") });
      return;
    }
    const maxSize = stats[0]?.size ?? 1;
    const chart = container.createDiv({ cls: "vsm-type-chart" });
    for (const stat of stats.slice(0, 80)) {
      const row = chart.createDiv({ cls: "vsm-type-row" });
      const swatch = row.createDiv({ cls: "vsm-type-swatch" });
      swatch.style.background = categoryColor(stat.extension);
      row.createDiv({ cls: "vsm-type-label", text: stat.extension });
      const bar = row.createDiv({ cls: "vsm-type-bar" });
      const fill = bar.createDiv({ cls: "vsm-type-bar-fill" });
      fill.style.width = `${Math.max(1, (stat.size / maxSize) * 100)}%`;
      fill.style.background = categoryColor(stat.extension);
      row.createDiv({ cls: "vsm-type-value", text: `${formatBytes(stat.size)} · ${stat.fileCount.toLocaleString()}` });
    }
  }

  private renderRecommendations(container: HTMLElement, result: ScanResult): void {
    container.createEl("h3", { text: this.plugin.t("recommendations") });
    container.createEl("p", { cls: "vsm-help-text", text: this.plugin.t("diagnosticOnly") });
    const recommendations = buildRecommendations(result, this.plugin);
    if (!recommendations.length) {
      const ok = container.createDiv({ cls: "vsm-recommendation is-ok" });
      setIcon(ok.createDiv({ cls: "vsm-recommendation-icon" }), "circle-check");
      ok.createDiv({ text: this.plugin.t("noRisks") });
      return;
    }
    for (const recommendation of recommendations) {
      const card = container.createDiv({ cls: `vsm-recommendation is-${recommendation.level}` });
      setIcon(card.createDiv({ cls: "vsm-recommendation-icon" }), recommendation.icon);
      const content = card.createDiv({ cls: "vsm-recommendation-content" });
      content.createEl("h4", { text: recommendation.title });
      content.createEl("p", { text: recommendation.description });
      const actions = content.createDiv({ cls: "vsm-recommendation-actions" });
      if (recommendation.path) {
        const button = actions.createEl("button", { text: this.plugin.t("reveal") });
        button.addEventListener("click", () => electronShell.showItemInFolder(recommendation.path!));
      }
      if (recommendation.copyText) {
        const button = actions.createEl("button", { text: this.plugin.t("copyRule") });
        button.addEventListener("click", () => {
          void navigator.clipboard.writeText(recommendation.copyText!);
          new Notice(this.plugin.t("copied"));
        });
      }
    }

    if (result.errors.length) {
      const details = container.createEl("details", { cls: "vsm-errors" });
      details.createEl("summary", { text: this.plugin.t("unreadableEntries", { count: result.errors.length }) });
      const list = details.createEl("ul");
      for (const error of result.errors.slice(0, 100)) list.createEl("li", { text: `${error.relativePath}: ${error.message}` });
    }
  }

  private renderDetails(layout: HTMLElement, result: ScanResult, selected: StorageNode): void {
    const collapsed = this.plugin.settings.detailsPanelCollapsed;
    const aside = layout.createEl("aside", { cls: `vsm-details${collapsed ? " is-collapsed" : ""}` });
    const toggle = aside.createEl("button", {
      cls: "vsm-details-toggle",
      attr: {
        type: "button",
        "aria-label": this.plugin.t(collapsed ? "showDetails" : "hideDetails"),
      },
    });
    setIcon(toggle, collapsed ? "panel-right-open" : "panel-right-close");
    toggle.createSpan({ cls: "vsm-sr-only", text: this.plugin.t(collapsed ? "showDetails" : "hideDetails") });
    toggle.addEventListener("click", () => void this.setDetailsCollapsed(!collapsed));

    if (collapsed) return;

    const heading = aside.createDiv({ cls: "vsm-details-heading" });
    heading.createEl("h3", { text: this.plugin.t("details") });
    const icon = aside.createDiv({ cls: "vsm-details-icon" });
    setIcon(icon, selected.kind === "folder" ? "folder" : "file");
    aside.createEl("h4", { text: selected.name });
    aside.createDiv({ cls: "vsm-details-path", text: selected.relativePath || selected.name });
    const parent = parentNode(result.root, selected.relativePath);
    const rows: Array<[string, string]> = [
      [this.plugin.t("itemKind"), this.plugin.t(selected.kind)],
      [this.plugin.t("size"), formatBytes(selected.size)],
      [this.plugin.t("shareVault"), formatPercent(selected.size, result.root.size)],
      [this.plugin.t("shareParent"), formatPercent(selected.size, parent?.size ?? result.root.size)],
    ];
    if (selected.kind === "folder") {
      rows.push([this.plugin.t("itemFiles"), selected.fileCount.toLocaleString()]);
      rows.push([this.plugin.t("itemFolders"), selected.folderCount.toLocaleString()]);
    } else {
      rows.push([this.plugin.t("type"), selected.extension ?? "—"]);
      rows.push([this.plugin.t("modified"), selected.modifiedAt ? formatDate(selected.modifiedAt, this.plugin.resolveLanguage()) : "—"]);
    }
    const dl = aside.createEl("dl", { cls: "vsm-details-list" });
    for (const [label, value] of rows) {
      dl.createEl("dt", { text: label });
      dl.createEl("dd", { text: value });
    }
    const actions = aside.createDiv({ cls: "vsm-details-actions" });
    const primary = actions.createEl("button", { cls: "mod-cta", text: selected.kind === "folder" ? this.plugin.t("drillDown") : this.plugin.t("open") });
    primary.addEventListener("click", () => {
      if (selected.kind === "folder") {
        this.activeTab = "treemap";
        this.treemapPath = selected.relativePath;
        this.render();
      } else this.openNode(selected);
    });
    const reveal = actions.createEl("button", { text: this.plugin.t("reveal") });
    reveal.addEventListener("click", () => electronShell.showItemInFolder(selected.absolutePath));
    const copy = actions.createEl("button", { text: this.plugin.t("copyPath") });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(selected.absolutePath);
      new Notice(this.plugin.t("copied"));
    });
  }

  private async setDetailsCollapsed(collapsed: boolean): Promise<void> {
    this.plugin.settings.detailsPanelCollapsed = collapsed;
    await this.plugin.saveSettings();
    this.render();
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: "vsm-footer" });
    footer.createSpan({ text: this.plugin.t("developedBy") });
    footer.createSpan({ text: this.plugin.t("localReadOnly") });
    footer.createSpan({ text: this.plugin.t("version", { version: this.plugin.manifest.version }) });
  }

  private selectNode(node: StorageNode): void {
    this.selectedPath = node.relativePath;
    if (this.plugin.settings.detailsPanelCollapsed) {
      this.plugin.settings.detailsPanelCollapsed = false;
      void this.plugin.saveSettings();
    }
    this.render();
  }

  private filterNodes(nodes: StorageNode[]): StorageNode[] {
    return nodes.filter((node) => {
      if (node.size < this.minimumSize) return false;
      if (!this.searchQuery) return true;
      return `${node.name} ${node.relativePath} ${node.extension ?? ""}`.toLocaleLowerCase().includes(this.searchQuery);
    });
  }

  private openNode(node: StorageNode): void {
    if (node.kind === "folder") {
      electronShell.showItemInFolder(join(node.absolutePath, "."));
      return;
    }
    const file = this.app.vault.getFileByPath(node.relativePath);
    if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
    else electronShell.showItemInFolder(node.absolutePath);
  }
}

class VaultStorageMapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultStorageMapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(this.plugin.t("settingsTitle")).setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: this.plugin.t("developedBy") });

    new Setting(containerEl)
      .setName(this.plugin.t("languageSetting"))
      .setDesc(this.plugin.t("languageDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", this.plugin.t("languageAuto"))
        .addOption("ru", this.plugin.t("languageRussian"))
        .addOption("en", this.plugin.t("languageEnglish"))
        .addOption("zh-cn", this.plugin.t("languageChinese"))
        .addOption("fr", this.plugin.t("languageFrench"))
        .addOption("de", this.plugin.t("languageGerman"))
        .addOption("es", this.plugin.t("languageSpanish"))
        .addOption("it", this.plugin.t("languageItalian"))
        .addOption("tr", this.plugin.t("languageTurkish"))
        .addOption("hi", this.plugin.t("languageHindi"))
        .addOption("bn", this.plugin.t("languageBengali"))
        .addOption("ta", this.plugin.t("languageTamil"))
        .addOption("pt", this.plugin.t("languagePortuguese"))
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value as LanguageMode;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("themeSetting"))
      .setDesc(this.plugin.t("themeDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("system", this.plugin.t("themeSystem"))
        .addOption("light", this.plugin.t("themeLight"))
        .addOption("dark", this.plugin.t("themeDark"))
        .setValue(this.plugin.settings.theme)
        .onChange(async (value) => {
          this.plugin.settings.theme = value as ThemeMode;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("colorSetting"))
      .setDesc(this.plugin.t("colorDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("type", this.plugin.t("colorType"))
        .addOption("size", this.plugin.t("colorSize"))
        .addOption("depth", this.plugin.t("colorDepth"))
        .setValue(this.plugin.settings.treemapColorMode)
        .onChange(async (value) => {
          this.plugin.settings.treemapColorMode = value as TreemapColorMode;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    addToggleSetting(containerEl, this.plugin.t("includeHidden"), this.plugin.t("includeHiddenDesc"), this.plugin.settings.includeHidden, async (value) => {
      this.plugin.settings.includeHidden = value;
      await this.plugin.saveSettings();
    });
    addToggleSetting(containerEl, this.plugin.t("includeObsidian"), this.plugin.t("includeObsidianDesc"), this.plugin.settings.includeObsidianConfig, async (value) => {
      this.plugin.settings.includeObsidianConfig = value;
      await this.plugin.saveSettings();
    });
    addToggleSetting(containerEl, this.plugin.t("scanOnOpen"), this.plugin.t("scanOnOpenDesc"), this.plugin.settings.scanOnViewOpen, async (value) => {
      this.plugin.settings.scanOnViewOpen = value;
      await this.plugin.saveSettings();
    });
    addToggleSetting(containerEl, this.plugin.t("cacheLast"), this.plugin.t("cacheLastDesc"), this.plugin.settings.cacheLastScan, async (value) => {
      this.plugin.settings.cacheLastScan = value;
      if (!value) await this.plugin.clearCachedResult();
      await this.plugin.saveSettings();
    });
    addToggleSetting(containerEl, this.plugin.t("followLinks"), this.plugin.t("followLinksDesc"), this.plugin.settings.followSymbolicLinks, async (value) => {
      this.plugin.settings.followSymbolicLinks = value;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName(this.plugin.t("largeThreshold"))
      .setDesc(this.plugin.t("largeThresholdDesc"))
      .addText((text) => text.setValue(String(this.plugin.settings.largeFileThresholdMb)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          this.plugin.settings.largeFileThresholdMb = parsed;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName(this.plugin.t("maxRows"))
      .setDesc(this.plugin.t("maxRowsDesc"))
      .addText((text) => text.setValue(String(this.plugin.settings.maxTableRows)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 20 && parsed <= 5000) {
          this.plugin.settings.maxTableRows = parsed;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName(this.plugin.t("exclusions"))
      .setDesc(this.plugin.t("exclusionsDesc"))
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.excludePatterns);
        text.inputEl.rows = 7;
        text.inputEl.cols = 44;
        text.onChange(async (value) => {
          this.plugin.settings.excludePatterns = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(this.plugin.t("clearCurrent"))
      .setDesc(this.plugin.t("clearCurrentDesc"))
      .addButton((button) => button.setButtonText(this.plugin.t("clear")).onClick(() => {
        this.plugin.scanResult = null;
        this.plugin.loadedFromCache = false;
        this.plugin.refreshViews();
      }));

    new Setting(containerEl)
      .setName(this.plugin.t("clearCache"))
      .setDesc(this.plugin.t("clearCacheDesc"))
      .addButton((button) => button.setButtonText(this.plugin.t("clear")).onClick(async () => {
        await this.plugin.clearCachedResult();
        this.plugin.loadedFromCache = false;
        new Notice(this.plugin.t("cacheCleared"));
      }));
  }
}

function addToggleSetting(container: HTMLElement, name: string, description: string, value: boolean, onChange: (value: boolean) => Promise<void>): void {
  new Setting(container).setName(name).setDesc(description).addToggle((toggle) => toggle.setValue(value).onChange(onChange));
}

function binaryTreemap(nodes: StorageNode[], x: number, y: number, width: number, height: number, depth: number): TreemapRect[] {
  if (!nodes.length || width <= 0 || height <= 0) return [];
  if (nodes.length === 1) return [{ node: nodes[0], x, y, width, height, depth }];
  const total = nodes.reduce((sum, node) => sum + node.size, 0) || 1;
  let running = 0;
  let splitIndex = 1;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    running += nodes[index].size;
    splitIndex = index + 1;
    if (running >= total / 2) break;
  }
  const first = nodes.slice(0, splitIndex);
  const second = nodes.slice(splitIndex);
  const firstTotal = first.reduce((sum, node) => sum + node.size, 0);
  const ratio = Math.max(0.05, Math.min(0.95, firstTotal / total));
  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...binaryTreemap(first, x, y, firstWidth, height, depth + 1),
      ...binaryTreemap(second, x + firstWidth, y, width - firstWidth, height, depth + 1),
    ];
  }
  const firstHeight = height * ratio;
  return [
    ...binaryTreemap(first, x, y, width, firstHeight, depth + 1),
    ...binaryTreemap(second, x, y + firstHeight, width, height - firstHeight, depth + 1),
  ];
}

function flattenNodes(root: StorageNode, kind?: NodeKind): StorageNode[] {
  const output: StorageNode[] = [];
  const visit = (node: StorageNode): void => {
    if (!kind || node.kind === kind) output.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return output;
}

function findNode(root: StorageNode, relativePath: string): StorageNode | null {
  if (!relativePath) return root;
  const parts = relativePath.split("/");
  let current = root;
  for (const part of parts) {
    const next = current.children?.find((child) => child.name === part);
    if (!next) return null;
    current = next;
  }
  return current;
}

function parentNode(root: StorageNode, relativePath: string): StorageNode | null {
  const parts = relativePath.split("/");
  if (parts.length <= 1) return root;
  return findNode(root, parts.slice(0, -1).join("/"));
}

function fileExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase().replace(/^\./, "");
  return extension || "(no extension)";
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];
    if (char === "*" && next === "*") {
      pattern += ".*";
      i += 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${pattern}$`, "i");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatBytesSigned(bytes: number): string {
  if (bytes === 0) return "0 B";
  return `${bytes < 0 ? "−" : ""}${formatBytes(Math.abs(bytes))}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

function formatDate(timestamp: number, language: ResolvedLanguage): string {
  const locale = language === "zh-cn" ? "zh-CN" : language === "ru" ? "ru-RU" : "en-US";
  return new Date(timestamp).toLocaleString(locale);
}

function formatPercent(value: number, total: number): string {
  if (!total) return "0%";
  const percent = (value / total) * 100;
  return percent >= 10 ? `${percent.toFixed(1)}%` : `${percent.toFixed(2)}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStoredSummary(result: ScanResult): StoredSummary {
  const files = flattenNodes(result.root, "file").sort((a, b) => b.size - a.size);
  const folderSizes: Record<string, number> = {};
  for (const folder of flattenNodes(result.root, "folder").filter((node) => node.relativePath).sort((a, b) => b.size - a.size).slice(0, 500)) folderSizes[folder.relativePath] = folder.size;
  return {
    generatedAt: result.generatedAt,
    totalSize: result.root.size,
    fileCount: result.root.fileCount,
    folderCount: result.root.folderCount,
    largestFilePath: files[0]?.relativePath ?? null,
    largestFileSize: files[0]?.size ?? 0,
    folderSizes,
  };
}

function addMetricCard(container: HTMLElement, label: string, value: string, iconName: string, delta?: string, detail?: string): void {
  const card = container.createDiv({ cls: "vsm-card" });
  const icon = card.createDiv({ cls: "vsm-card-icon" });
  setIcon(icon, iconName);
  const content = card.createDiv({ cls: "vsm-card-content" });
  content.createDiv({ cls: "vsm-card-value", text: value });
  content.createDiv({ cls: "vsm-card-label", text: label });
  if (delta) content.createDiv({ cls: delta.startsWith("+") ? "vsm-card-delta is-growth" : "vsm-card-delta is-shrink", text: delta });
  if (detail) content.createDiv({ cls: "vsm-card-detail", text: detail });
}

function storageDelta(current: number, previous?: number): string | undefined {
  if (previous === undefined) return undefined;
  const delta = current - previous;
  if (!delta) return undefined;
  return `${delta > 0 ? "+" : ""}${formatBytesSigned(delta)}`;
}

function addIconButton(container: HTMLElement, iconName: string, title: string, action: () => void): void {
  const button = container.createEl("button", { cls: "vsm-icon-button", attr: { "aria-label": title, title } });
  setIcon(button, iconName);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
}

function buildRecommendations(result: ScanResult, plugin: VaultStorageMapPlugin): Recommendation[] {
  const settings = plugin.settings;
  const recommendations: Recommendation[] = [];
  const files = flattenNodes(result.root, "file").sort((a, b) => b.size - a.size);
  const folders = flattenNodes(result.root, "folder");
  const threshold = settings.largeFileThresholdMb * 1024 * 1024;
  const largeFiles = files.filter((file) => file.size >= threshold);
  const obsidianFolder = folders.find((folder) => folder.relativePath === plugin.app.vault.configDir);
  const copilotIndexes = files.filter((file) => /(^|\/)copilot-index-.*\.json$/i.test(file.relativePath));

  if (largeFiles.length) {
    const largest = largeFiles[0];
    recommendations.push({
      level: largest.size >= threshold * 4 ? "danger" : "warning",
      icon: "file-warning",
      title: plugin.t("largeFilesTitle", { count: largeFiles.length }),
      description: plugin.t("largeFilesDesc", { path: largest.relativePath, size: formatBytes(largest.size) }),
      path: largest.absolutePath,
    });
  }

  if (obsidianFolder && (obsidianFolder.size > 100 * 1024 * 1024 || obsidianFolder.size > result.root.size * 0.2)) {
    recommendations.push({
      level: "warning",
      icon: "settings",
      title: plugin.t("obsidianTitle", { percent: formatPercent(obsidianFolder.size, result.root.size) }),
      description: plugin.t("obsidianDesc", { size: formatBytes(obsidianFolder.size) }),
      path: obsidianFolder.absolutePath,
    });
  }

  if (copilotIndexes.length) {
    const total = copilotIndexes.reduce((sum, file) => sum + file.size, 0);
    recommendations.push({
      level: total > 100 * 1024 * 1024 ? "danger" : "info",
      icon: "database",
      title: plugin.t("copilotTitle", { size: formatBytes(total) }),
      description: plugin.t("copilotDesc"),
      path: copilotIndexes[0].absolutePath,
      copyText: `${plugin.app.vault.configDir}/copilot-index-*.json`,
    });
  }

  const attachments = folders
    .filter((folder) => /(^|\/)(attachments?|assets?|media|images?)$/i.test(folder.relativePath))
    .sort((a, b) => b.size - a.size)[0];
  if (attachments && attachments.size > result.root.size * 0.5) {
    recommendations.push({
      level: "info",
      icon: "image",
      title: plugin.t("attachmentsTitle"),
      description: plugin.t("attachmentsDesc", { path: attachments.relativePath, size: formatBytes(attachments.size), percent: formatPercent(attachments.size, result.root.size) }),
      path: attachments.absolutePath,
    });
  }

  if (result.errors.length) {
    recommendations.push({
      level: "warning",
      icon: "shield-alert",
      title: plugin.t("unreadableTitle", { count: result.errors.length }),
      description: plugin.t("unreadableDesc"),
    });
  }
  return recommendations;
}

function categoryColor(extension: string): string {
  const ext = extension.toLowerCase();
  if (["md", "txt", "canvas"].includes(ext)) return "hsl(213 82% 58%)";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext)) return "hsl(286 68% 60%)";
  if (["pdf", "doc", "docx", "odt", "rtf"].includes(ext)) return "hsl(355 78% 59%)";
  if (["mp3", "wav", "ogg", "m4a", "flac", "mp4", "mkv", "webm", "mov"].includes(ext)) return "hsl(28 90% 57%)";
  if (["json", "db", "sqlite", "sqlite3", "index"].includes(ext)) return "hsl(165 64% 43%)";
  if (["js", "ts", "css", "html", "py", "java", "c", "cpp", "go", "rs"].includes(ext)) return "hsl(48 90% 51%)";
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "hsl(104 47% 50%)";
  if (ext === "folder") return "hsl(225 62% 57%)";
  return "hsl(217 14% 55%)";
}

function treemapColor(node: StorageNode, mode: TreemapColorMode, depth: number, share: number): string {
  if (mode === "type") return categoryColor(node.kind === "folder" ? "folder" : node.extension ?? "");
  if (mode === "depth") return `hsl(${205 + (depth * 33) % 140} 68% ${48 + (depth % 3) * 6}%)`;
  const hue = 120 - Math.min(120, share * 480);
  return `hsl(${hue} 72% 52%)`;
}

function countNodes(root: StorageNode): number {
  let count = 0;
  const visit = (node: StorageNode): void => {
    count += 1;
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return count;
}

function dehydrateNode(node: StorageNode): CachedStorageNode {
  return {
    name: node.name,
    relativePath: node.relativePath,
    kind: node.kind,
    size: node.size,
    fileCount: node.fileCount,
    folderCount: node.folderCount,
    modifiedAt: node.modifiedAt,
    extension: node.extension,
    children: node.children?.map(dehydrateNode),
  };
}

function hydrateNode(node: CachedStorageNode, rootPath: string): StorageNode {
  return {
    ...node,
    absolutePath: node.relativePath ? join(rootPath, ...node.relativePath.split("/")) : rootPath,
    children: node.children?.map((child) => hydrateNode(child, rootPath)),
  };
}

function uniqueVaultPath(app: App, initialPath: string): string {
  if (!app.vault.getAbstractFileByPath(initialPath)) return initialPath;
  const extension = extname(initialPath);
  const base = initialPath.slice(0, -extension.length);
  let index = 2;
  while (app.vault.getAbstractFileByPath(`${base} ${index}${extension}`)) index += 1;
  return `${base} ${index}${extension}`;
}

function buildMarkdownReport(result: ScanResult, plugin: VaultStorageMapPlugin): string {
  const folders = flattenNodes(result.root, "folder").filter((node) => node.relativePath).sort((a, b) => b.size - a.size).slice(0, 30);
  const files = flattenNodes(result.root, "file").sort((a, b) => b.size - a.size).slice(0, 50);
  const lines = [
    `# ${plugin.t("pluginName")} — ${plugin.t("summary")}`,
    "",
    `> ${plugin.t("developedBy")}`,
    `> ${plugin.t("localReadOnly")}`,
    "",
    `- ${plugin.t("scannedAt", { date: formatDate(result.generatedAt, plugin.resolveLanguage()) })}`,
    `- ${plugin.t("totalSize")}: **${formatBytes(result.root.size)}**`,
    `- ${plugin.t("files")}: **${result.root.fileCount.toLocaleString()}**`,
    `- ${plugin.t("folders")}: **${result.root.folderCount.toLocaleString()}**`,
    "",
    `## ${plugin.t("topFolders")}`,
    "",
    `| ${plugin.t("path")} | ${plugin.t("size")} | ${plugin.t("percentVault")} |`,
    "|---|---:|---:|",
    ...folders.map((node) => `| ${escapeMarkdown(node.relativePath)} | ${formatBytes(node.size)} | ${formatPercent(node.size, result.root.size)} |`),
    "",
    `## ${plugin.t("topFiles")}`,
    "",
    `| ${plugin.t("path")} | ${plugin.t("type")} | ${plugin.t("size")} |`,
    "|---|---|---:|",
    ...files.map((node) => `| ${escapeMarkdown(node.relativePath)} | ${node.extension ?? "—"} | ${formatBytes(node.size)} |`),
    "",
  ];
  return lines.join("\n");
}

function buildCsvReport(result: ScanResult): string {
  const header = ["kind", "relative_path", "size_bytes", "size_human", "file_count", "folder_count", "extension", "modified_at"];
  const rows = flattenNodes(result.root).filter((node) => node.relativePath).map((node) => [
    node.kind,
    node.relativePath,
    String(node.size),
    formatBytes(node.size),
    String(node.fileCount),
    String(node.folderCount),
    node.extension ?? "",
    node.modifiedAt ? new Date(node.modifiedAt).toISOString() : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function buildPortableReport(result: ScanResult): object {
  return {
    generatedAt: new Date(result.generatedAt).toISOString(),
    durationMs: result.durationMs,
    totalSize: result.root.size,
    fileCount: result.root.fileCount,
    folderCount: result.root.folderCount,
    extensions: result.extensions,
    nodes: flattenNodes(result.root).filter((node) => node.relativePath).map((node) => ({
      kind: node.kind,
      relativePath: node.relativePath,
      size: node.size,
      fileCount: node.fileCount,
      folderCount: node.folderCount,
      extension: node.extension,
      modifiedAt: node.modifiedAt,
    })),
    errors: result.errors,
  };
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|");
}
