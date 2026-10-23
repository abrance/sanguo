// 官渡 200 武将表：在讨董 135 人基础上做「亡者除名 + 归属重排 + 补录新将」
//
// 行格式：[id, 名, 武, 统, 智, 政, 魅, 特技, 所属势力]
// 这样写而不是抄一份 135 行：名单一改两处都得改，迟早对不上。
const GUANDU200_DEAD = [
  'dongzhuo', 'lvbu', 'huaxiong', 'liru', 'lijue', 'guosi', 'fanchou', 'niufu', 'xurong',
  'sunjian', 'gongsunzan', 'liuyu', 'hanfu', 'zhangyang', 'yuanshu', 'liuyan',
  'liudai', 'kongzhou', 'taoqian',
];

/** 旧归属 → 官渡归属：主公易姓的几家整体改属 */
const GUANDU200_REMAP = {
  dongzhuo: 'free',
  gongsunzan: 'yuanshao',
  hanfu: 'yuanshao',
  liuyu: 'yuanshao',
  zhangyang: 'yuanshao',
  kongzhou: 'caocao',
  liudai: 'caocao',
  taoqian: 'caocao',
  kongrong: 'caocao',
  yuanshu: 'free',
  sunjian: 'sunce',
  liuyao: 'sunce',
  liuyan: 'liuzhang',
};

/** 补录：190 年还不出名、200 年已登场的人（数值按 200 年的状态） */
const GUANDU200_EXTRA_ROWS = [
  ['guojia',    '郭嘉',  25, 60, 96, 78, 72, 'jizhi',     'caocao'],
  ['zhangliao', '张辽',  92, 93, 78, 55, 65, 'tuji',      'caocao'],
  ['simayi',    '司马懿', 40, 72, 97, 86, 70, 'jizhi',     'caocao'],
  ['zhangxiu',  '张绣',  86, 80, 60, 45, 55, 'tuji',      'caocao'],
  ['xunyou2',   '许攸',  30, 55, 88, 70, 48, 'jizhi',     'caocao'],
  ['pangtong',  '庞统',  32, 58, 95, 76, 55, 'jizhi',     'liubiao'],
  ['ganning',   '甘宁',  88, 80, 62, 40, 55, 'shuijun',   'sunce'],
  ['lingtong',  '凌统',  83, 78, 58, 45, 62, 'xianzhen',  'sunce'],
  ['taishici2', '太史慈', 92, 86, 72, 60, 78, 'shenyi',    'sunce'],
];

const GUANDU200_HERO_ROWS = (() => {
  const rows = [];
  for (const r of TAODONG190_HERO_ROWS) {
    const id = r[0];
    if (GUANDU200_DEAD.indexOf(id) >= 0) continue;
    const fid = GUANDU200_REMAP[r[8]] || r[8];
    // 太史慈在 190 表里属刘繇，官渡时已归孙策 —— 由 remap 处理（liuyao→sunce）
    rows.push([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], fid]);
  }
  for (const r of GUANDU200_EXTRA_ROWS) {
    if (!rows.some(x => x[0] === r[0])) rows.push(r.slice());
  }
  return rows;
})();
