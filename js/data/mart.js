// 市肆（商店）：每月换一次货，用钱换「钱买不到的东西」。
//
// 存在的理由只有一个：给府库里的钱一个出口（DESIGN §11.3「后期金钱堆积」）。
// 所以每件货都必须回答「钱在这儿换成了什么」：
//   res    → 建材 / 铁料 / 粮（钱多料少的城墙期）
//   troop  → 兵（不吃丁口，后期丁口才是真瓶颈）
//   craft  → 工期（本城在建工程 -1 月）
//   treasure → 宝物（钱直接从别处买不到的稀缺品）
//
// 价格一律「基准 × 市集 × 关市 × 季 × 天赋」，面板上把每一项摊开写出来（不暗改数值）。
// amt / price 都按市集等级算 —— 市集不只是钱入，也是「这城有没有东西可买、贵不贵」。

const MART_GOODS = {
  mat: {
    id: 'mat', kind: 'res', key: 'mat', name: '木石料', unitName: '建材',
    amt: m => 80 + m * 20,
    base: m => (80 + m * 20) * 0.85,
    minMarket: 1,
    about: '荆楚大木与青石。匠人多、料跟不上时，最该来这一趟。',
  },
  grain: {
    id: 'grain', kind: 'res', key: 'food', name: '粮秣', unitName: '粮',
    amt: m => 260 + m * 90,
    base: m => (260 + m * 90) * 0.10,
    minMarket: 1,
    about: '秋收谷贱、春荒谷贵 —— 价随季浮动，囤与不囤自己想。',
  },
  iron: {
    id: 'iron', kind: 'res', key: 'iron', name: '精铁', unitName: '铁料',
    amt: m => 18 + m * 6,
    base: m => (18 + m * 6) * 1.70,
    minMarket: 1, bld: 'ironworks',
    about: '百炼之铁。没有冶铁坊，这批货卸下来也没人吃得消。',
  },
  levy: {
    id: 'levy', kind: 'troop', name: '游侠投军', unitName: '兵',
    amt: m => 180 + m * 55,
    base: m => (180 + m * 55) * 0.62,
    minMarket: 1, bld: 'barracks',
    about: '不要丁口，只要钱。兵额装得下才收。',
  },
  craft: {
    id: 'craft', kind: 'craft', name: '良匠', unitName: '工期',
    amt: () => 1,
    base: () => 420,
    minMarket: 2, bld: 'office',
    about: '赶工一场：本城在建工程缩短 1 个月。',
  },
  relic: {
    id: 'relic', kind: 'treasure', name: '稀珍', unitName: '件',
    amt: () => 1,
    base: () => 620,          // 实际价另加 稀有度 × 380（见 Mart.slotOf）
    minMarket: 3,
    about: '来路不明的旧物，有几分像名器。',
  },
};

/** 常驻货位：这两样每座城的市肆都有，其余按需抽 */
const MART_ALWAYS = ['mat', 'grain'];

/** 抽签池（门槛不合的会被筛掉） */
const MART_POOL = ['iron', 'levy', 'craft', 'relic'];

/** 价格中的「季」因子：秋天谷料便宜，冬天什么都贵 */
const MART_SEASON = { spring: 1.00, summer: 0.98, autumn: 0.90, winter: 1.08 };
