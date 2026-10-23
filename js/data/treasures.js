// 宝物：20 件，5 类（docs/HERO.md §4）
// eff 只加派生属性（State.heroStat 读取），不改武将本体五维。
// rare 1-3 只影响掉落权重与边框，不影响数值陡度（数值已写死）。
const TREASURES = {
  // ── 兵器（武） ──
  qinggang:  { id: 'qinggang',  name: '青釭剑',   cat: 'weapon', rare: 2, eff: { wu: 4 }, about: '削铁如泥，曹操令夏侯恩负之。' },
  zhangba:   { id: 'zhangba',   name: '丈八蛇矛', cat: 'weapon', rare: 2, eff: { wu: 5 }, about: '张翼德所执，矛长丈八，瞋目横矛，无人敢近。' },
  fangtian:  { id: 'fangtian',  name: '方天画戟', cat: 'weapon', rare: 3, eff: { wu: 6 }, about: '吕布所持，辕门射戟，天下无双。' },
  guding:    { id: 'guding',    name: '古锭刀',   cat: 'weapon', rare: 1, eff: { wu: 3 }, about: '孙坚破董卓时所佩，刀身有古纹。' },
  shuanggu:  { id: 'shuanggu',  name: '双股剑',   cat: 'weapon', rare: 1, eff: { wu: 2 }, about: '刘玄德起兵时铸，一雌一雄。' },

  // ── 甲胄（统 / 守城） ──
  mingguang: { id: 'mingguang', name: '明光铠',   cat: 'armor', rare: 2, eff: { tong: 3, defenseCity: 0.03 }, about: '胸前两镜，日照有光，矢石难入。' },
  shoumian:  { id: 'shoumian',  name: '兽面吞头铠', cat: 'armor', rare: 3, eff: { tong: 4, defenseCity: 0.04 }, about: '重甲兽面，临阵先声夺人。' },
  tengjia:   { id: 'tengjia',   name: '藤甲',     cat: 'armor', rare: 1, eff: { tong: 2 }, about: '南中藤浸油所制，轻而拒刃，然惧火。' },
  huanjia:   { id: 'huanjia',   name: '环锁铠',   cat: 'armor', rare: 1, eff: { tong: 2 }, about: '西域贡物，环环相扣。' },

  // ── 坐骑（行军 / 骑战） ──
  chitu:     { id: 'chitu',     name: '赤兔',     cat: 'mount', rare: 3, eff: { speed: 0.15, cav: 0.05 }, about: '日行千里，人中吕布，马中赤兔。' },
  dilu:      { id: 'dilu',      name: '的卢',     cat: 'mount', rare: 2, eff: { speed: 0.12, cav: 0.04 }, about: '跃马檀溪，妨主之名不攻自破。' },
  zhuahuang: { id: 'zhuahuang', name: '爪黄飞电', cat: 'mount', rare: 2, eff: { speed: 0.10, cav: 0.03 }, about: '曹操行猎所乘，色黄而足白。' },
  jueying:   { id: 'jueying',   name: '绝影',     cat: 'mount', rare: 1, eff: { speed: 0.08, cav: 0.02 }, about: '身中三矢犹能疾驰，故名绝影。' },

  // ── 典籍（智 / 政） ──
  mengde:    { id: 'mengde',    name: '孟德新书', cat: 'book', rare: 2, eff: { zhi: 4, zheng: 2 }, about: '曹操手订兵书，诸将各授一卷。' },
  sunzi:     { id: 'sunzi',     name: '孙子兵法', cat: 'book', rare: 3, eff: { zhi: 6, zheng: 2 }, about: '十三篇，兵家之祖。' },
  taigong:   { id: 'taigong',   name: '太公六韬', cat: 'book', rare: 2, eff: { zhi: 3, zheng: 3 }, about: '文伐武成，帝王之师。' },
  chunqiu:   { id: 'chunqiu',   name: '春秋左氏传', cat: 'book', rare: 1, eff: { zhi: 3 }, about: '关羽夜读不倦，义在其中。' },

  // ── 印绶（魅 / 名望） ──
  chuanguo:  { id: 'chuanguo',  name: '传国玉玺', cat: 'seal', rare: 3, eff: { mei: 5, reputation: 6 }, about: '受命于天，既寿永昌。' },
  hanshou:   { id: 'hanshou',   name: '汉寿亭侯印', cat: 'seal', rare: 2, eff: { mei: 4, reputation: 4 }, about: '曹操表封关羽，印绶随身。' },
  dudu:      { id: 'dudu',      name: '都督印',   cat: 'seal', rare: 1, eff: { mei: 3, reputation: 2 }, about: '总领诸军之信物。' },
};

const TREASURE_KEYS = Object.keys(TREASURES);
const TREASURE_CATS = ['weapon', 'armor', 'mount', 'book', 'seal'];
const TREASURE_CAT_NAME = {
  weapon: '兵器', armor: '甲胄', mount: '坐骑', book: '典籍', seal: '印绶',
};

// 开局哪些城的府库里躺着宝物（只列定的几座，其余靠破城/赏赐掉落）
const TAODONG190_TREASURE_CITIES = {
  luoyang:  ['chuanguo', 'sunzi'],
  changan:  ['fangtian', 'mingguang'],
  ye:       ['mengde'],
  chengdu:  ['shoumian'],
  jiangling: ['taigong'],
  xuchang:  ['qinggang'],
  beihai:   ['chunqiu'],
  jinyang:  ['chitu'],
};
