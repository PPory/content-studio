// 图标统一从这里出去，别的文件不直接 import "@tabler/icons-react"。
//
// 两个原因：
//  1. tabler 那个包是个 5000+ 图标的 barrel，Vite 预打包它一次就够了；散在十个文件里
//     引，改一个页面就可能触发一次重新预打包。
//  2. 线宽、尺寸这类视觉参数要能一处改。默认 stroke=1.7 是这套设计的基调——
//     2 太重，压过正文；1.5 在 13px 的导航里发虚。

export {
  IconHome,
  IconRadar2,
  IconSocial,
  IconBulb,
  IconStack2,
  IconBooks,
  IconClipboardList,
  IconFileText,
  IconChartLine,
  IconPlus,
  IconRefresh,
  // 平台热榜的榜名图标。tabler 只有这四个中文平台的品牌图标，
  // 今日头条和小红书没有——用语义最近的通用图标顶上（见 Hotspots 的 BOARD_ICONS）
  IconBrandWeibo,
  IconBrandTiktok,
  IconBrandBilibili,
  IconMessageQuestion,
  IconNews,
  IconNotebook,
  // 分面下拉里**每个选项自己的**图标（平台 / 素材类型），见 ui.jsx 的 valueIcon
  IconBrandX,
  IconBrandYoutube,
  IconVideo,
  IconSitemap,
  IconArrowsExchange,
  // Markdown 编辑器的工具栏（IconEye / IconQuote / IconList 上面已经导出过了）
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconListNumbers,
  IconSeparator,
  IconHeading,
  IconSettings,
  IconArrowUpRight,
  IconExternalLink,
  IconClock,
  IconEye,
  IconShieldCheck,
  IconNotes,
  IconSparkles,
  IconMessageCircle,
  IconQuote,
  IconSearch,
  IconArrowLeft,
  IconX,
  IconAlertTriangle,
  IconCheck,
  IconBrandWechat,
  IconPhoto,
  IconArchive,
  IconFolder,
  IconDatabase,
  IconPencil,
  IconLoader2,
  IconChevronRight,
  IconUpload,
  IconListSearch,
  IconBookmark,
  IconBookmarkFilled,
  IconLayoutGrid,
  IconList,
  IconCalendarEvent,
  IconTag,
  IconTrash,
  IconHighlight,
  IconLanguage,
  IconArrowsDiagonal,
  IconScale,
  IconWand,
  IconChevronLeft,
  IconChevronsRight,
  IconChevronsLeft,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconTypography,
  IconLayoutKanban,
  IconBook2,
  IconGripVertical,
  IconArrowRight,
  IconFileImport,
  IconSend,
  IconCopy,
  IconInbox,
  IconBook,
  IconCategory,
  IconCoin,
  IconFlag,
  IconTarget,
  IconUser,
  IconUsers,
  IconWorld,
  IconChevronDown,
  IconLink,
  IconCircleDashed,
  IconCircleCheck,
  IconCircleX,
  IconCircleDot,
  IconProgress,
  IconAlertCircle,
  IconTable,
  IconChartBar,
  IconCloudUpload,
  IconRoute,
  IconHistory,
  IconFilter,
  IconDownload,
} from "@tabler/icons-react";

// 导航图标：key 就是路由 key，加新页面时在这里挂一个图标即可。
import {
  IconHome as Home,
  IconRadar2 as Radar,
  IconSocial as Social,
  IconStack2 as Stack,
  IconBooks as Books,
  IconBrandWechat as Wechat,
  IconChartLine as ChartLine,
} from "@tabler/icons-react";

/**
 * 品牌标记：来自 `02--Resources/04--设计素材/logo-X字母黑底白色-20260812.svg`。
 * 形状是「三个圆角 + 右下一个直角」的块，里面一个白色的 X（Xenho 的首字母）。
 *
 * **底色和 X 走语义 token，不写死黑白。** 素材本身是黑底白字，但那一版直接搬进来的话，
 * 暗色模式下这块纯黑会糊进深色背景里——侧栏当前项的黑块在暗色下同样是翻成白的，
 * logo 不跟着翻就成了整屏唯一一个不认主题的东西。所以底色吃 `--accent`、
 * X 吃 `--on-accent`（「黑块上的字色」那个 token 正是为这种场合准备的）。
 *
 * 尺寸交给外面的 `.brand-mark` 定：展开态 26px 配 17px 的品牌名，收起态要放大到和
 * 导航项的方块一样（见 styles.css 里的收起规则）。
 *
 * ⚠️ **两条 path 和 index.html 的 favicon 是同一份，改一处必须改两处。**
 * 那边是 data URI，没法 import 组件；viewBox 也照抄这里的，两边能逐字对拷。
 */
export function BrandMark() {
  return (
    <svg viewBox="0.92 0 299.24 299.24" className="brandmark" aria-hidden="true">
      <path
        className="brandmark__bg"
        d="M150.523438 0C67.894531 0 0.917969 66.976562 0.917969 149.605469 0.917969 232.234375 67.894531 299.210938 150.523438 299.210938L300.125 299.210938 300.125 149.605469C300.152344 66.976562 233.148438 0 150.523438 0Z"
      />
      <path
        className="brandmark__x"
        transform="translate(79.471746 226.479901)"
        d="M146.296875 0 103.578125 0 69.28125-49.40625 35 0-5.984375 0 48.890625-78.078125 3.171875-145.078125 42.546875-145.078125 69.28125-105.5 96.015625-145.078125 137.15625-145.078125 89.6875-78.078125Z"
      />
    </svg>
  );
}

export const NAV_ICONS = {
  overview: Home,
  hot: Radar,
  studio: Stack,
  insights: Social,
  shelf: Books,
  typeset: Wechat,
  metrics: ChartLine,
};
