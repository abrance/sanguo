// 讨董剧本武将（134 人）
// 行格式: [id, 名, 武, 统, 智, 政, 魅, 特技, 所属势力]
//   势力 'free' = 在野
const HERO_ROWS = [
  // ── 董卓军 ──
  ['dongzhuo', '董卓',  82, 78, 62, 20, 35, 'jianxiong', 'dongzhuo'],
  ['lvbu',     '吕布', 100, 72, 26, 13, 60, 'wushuang',  'dongzhuo'],
  ['liru',     '李儒',  22, 45, 95, 78, 40, 'huoji',     'dongzhuo'],
  ['huaxiong', '华雄',  88, 76, 35, 28, 45, 'tuji',      'dongzhuo'],
  ['lijue',    '李傕',  76, 70, 52, 30, 30, 'tuji',      'dongzhuo'],
  ['guosi',    '郭汜',  74, 68, 48, 25, 28, 'tuji',      'dongzhuo'],
  ['zhangji',  '张济',  72, 70, 50, 35, 40, 'shoucheng', 'dongzhuo'],
  ['fanchou',  '樊稠',  75, 66, 40, 28, 30, 'tuji',      'dongzhuo'],
  ['niufu',    '牛辅',  65, 60, 35, 25, 28, '',          'dongzhuo'],
  ['xurong',   '徐荣',  78, 88, 72, 50, 55, 'tiebi',     'dongzhuo'],
  ['jiaxu',    '贾诩',  30, 60, 97, 82, 45, 'jizhi',     'dongzhuo'],

  // ── 袁绍军 ──
  ['yuanshao',    '袁绍',  62, 70, 68, 70, 92, 'yangwei', 'yuanshao'],
  ['yanliang',    '颜良',  92, 78, 32, 25, 45, 'tuji',    'yuanshao'],
  ['wenchou',     '文丑',  90, 76, 34, 24, 44, 'tuji',    'yuanshao'],
  ['tianfeng',    '田丰',  20, 55, 94, 85, 60, 'jizhi',   'yuanshao'],
  ['juju',        '沮授',  25, 62, 92, 88, 62, 'jizhi',   'yuanshao'],
  ['shenpei',     '审配',  40, 60, 80, 82, 50, 'shoucheng', 'yuanshao'],
  ['guotu',       '郭图',  25, 45, 72, 65, 40, '',        'yuanshao'],
  ['zhanghe',     '张郃',  86, 90, 78, 60, 62, 'tiebi',   'yuanshao'],
  ['gaolan',      '高览',  82, 78, 60, 50, 50, '',        'yuanshao'],
  ['chunyuqiong', '淳于琼', 70, 62, 40, 42, 45, '',       'yuanshao'],

  // ── 曹操军 ──
  ['caocao',     '曹操',  78, 92, 94, 92, 96, 'jianxiong', 'caocao'],
  ['xiahoudun',  '夏侯惇', 90, 85, 62, 55, 70, 'tuji',    'caocao'],
  ['xiahouyuan', '夏侯渊', 88, 86, 65, 50, 62, 'tuji',    'caocao'],
  ['caoren',     '曹仁',  88, 90, 70, 62, 68, 'tiebi',    'caocao'],
  ['caohong',    '曹洪',  80, 70, 45, 40, 50, '',         'caocao'],
  ['yuejin',     '乐进',  82, 80, 62, 48, 52, 'xianzhen', 'caocao'],
  ['lidian',     '李典',  72, 76, 70, 60, 60, '',         'caocao'],
  ['xunyu',      '荀彧',  25, 60, 93, 96, 82, 'jizhi',    'caocao'],
  ['xunyou',     '荀攸',  30, 62, 92, 85, 70, 'jizhi',    'caocao'],
  ['chengyu',    '程昱',  40, 68, 88, 82, 62, 'huoji',    'caocao'],
  ['yujin',      '于禁',  82, 88, 68, 60, 55, 'xianzhen', 'caocao'],
  ['dianwei',    '典韦',  96, 60, 30, 20, 40, 'wushuang', 'caocao'],
  ['xuchu',      '许褚',  97, 62, 28, 18, 42, 'wushuang', 'caocao'],

  // ── 袁术军 ──
  ['yuanshu',  '袁术',  50, 52, 55, 45, 75, 'yangwei', 'yuanshu'],
  ['jiling',   '纪灵',  85, 76, 48, 35, 45, 'tuji',    'yuanshu'],
  ['zhangxun', '张勋',  72, 68, 50, 40, 38, '',        'yuanshu'],
  ['qiaorui',  '桥蕤',  68, 62, 45, 38, 35, '',        'yuanshu'],
  ['yanxiang', '阎象',  20, 40, 78, 72, 45, '',        'yuanshu'],

  // ── 孙坚军 ──
  ['sunjian',  '孙坚',  94, 90, 72, 62, 85, 'tuji',     'sunjian'],
  ['chengpu',  '程普',  84, 82, 72, 60, 65, '',         'sunjian'],
  ['huanggai', '黄盖',  86, 80, 65, 55, 60, 'huoji',    'sunjian'],
  ['handang',  '韩当',  84, 78, 60, 50, 55, '',         'sunjian'],
  ['zuma',     '祖茂',  72, 66, 50, 42, 48, '',         'sunjian'],
  ['sunce',    '孙策',  92, 86, 72, 60, 88, 'tuji',     'sunjian'],
  ['zhuzhi',   '朱治',  65, 70, 62, 58, 55, '',         'sunjian'],
  ['zhouyu',   '周瑜',  62, 78, 96, 88, 90, 'huoji',    'sunjian'],

  // ── 刘表军 ──
  ['liubiao',  '刘表',  45, 62, 78, 85, 88, 'shoucheng', 'liubiao'],
  ['caimao',   '蔡瑁',  60, 66, 55, 58, 45, 'shuijun',   'liubiao'],
  ['kuailiang','蒯良',  25, 50, 86, 88, 60, 'jizhi',     'liubiao'],
  ['kuaiyue',  '蒯越',  30, 55, 88, 85, 62, 'jizhi',     'liubiao'],
  ['huangzu',  '黄祖',  68, 70, 45, 48, 40, 'shuijun',   'liubiao'],
  ['wenpin',   '文聘',  82, 86, 66, 58, 60, 'tiebi',     'liubiao'],
  ['zhangyun', '张允',  55, 58, 45, 45, 38, 'shuijun',   'liubiao'],

  // ── 陶谦军 ──
  ['taoqian', '陶谦',  45, 58, 68, 72, 70, 'shoucheng', 'taoqian'],
  ['caobao',  '曹豹',  55, 58, 40, 38, 35, '',          'taoqian'],
  ['chendeng','陈登',  40, 66, 90, 85, 70, 'jizhi',     'taoqian'],
  ['mizhu',   '糜竺',  20, 40, 72, 88, 75, '',          'taoqian'],
  ['zangba',  '臧霸',  84, 80, 62, 55, 60, 'tuji',      'taoqian'],

  // ── 孔融军 ──
  ['kongrong', '孔融',  25, 40, 82, 78, 88, 'yangwei', 'kongrong'],
  ['wugu',     '武安国', 78, 62, 35, 30, 40, '',       'kongrong'],
  ['wangxiu',  '王修',  20, 45, 75, 78, 60, '',        'kongrong'],
  ['zongbao',  '宗宝',  62, 58, 38, 32, 35, '',        'kongrong'],

  // ── 公孙瓒军 ──
  ['gongsunzan',  '公孙瓒', 86, 84, 62, 55, 75, 'tuji',    'gongsunzan'],
  ['yangang',     '严纲',  76, 70, 45, 38, 42, 'tuji',    'gongsunzan'],
  ['danjing',     '单经',  70, 66, 42, 36, 40, '',        'gongsunzan'],
  ['tiankai',     '田楷',  68, 66, 50, 45, 45, '',        'gongsunzan'],
  ['gongsunyue',  '公孙越', 72, 68, 44, 36, 42, '',       'gongsunzan'],
  ['zhaoyun',     '赵云',  96, 92, 76, 65, 85, 'wushuang', 'gongsunzan'],

  // ── 公孙度军 ──
  ['gongsundu',  '公孙度', 62, 70, 62, 60, 58, 'shoucheng', 'gongsundu'],
  ['gongsunkang','公孙康', 68, 68, 55, 50, 50, '',          'gongsundu'],
  ['liuyi',      '柳毅',  60, 62, 50, 48, 42, '',          'gongsundu'],

  // ── 刘虞军 ──
  ['liuyu',     '刘虞',  35, 55, 72, 85, 90, 'yangwei', 'liuyu'],
  ['xianyufu',  '鲜于辅', 68, 70, 55, 55, 48, '',       'liuyu'],
  ['yanrou',    '阎柔',  70, 68, 55, 52, 50, 'tuji',    'liuyu'],
  ['qizhou',    '齐周',  60, 58, 48, 45, 42, '',        'liuyu'],

  // ── 韩馥军 ──
  ['hanfu',    '韩馥',  40, 45, 55, 60, 55, 'shoucheng', 'hanfu'],
  ['gengwu',   '耿武',  62, 60, 55, 52, 45, '',         'hanfu'],
  ['guanchun', '关纯',  58, 58, 50, 48, 42, '',         'hanfu'],
  ['quyi',     '麴义',  80, 84, 62, 50, 48, 'xianzhen', 'hanfu'],
  ['panfeng',  '潘凤',  72, 60, 35, 30, 38, '',         'hanfu'],

  // ── 张杨军 ──
  ['zhangyang', '张杨', 65, 68, 55, 52, 50, '', 'zhangyang'],
  ['yangchou',  '杨丑', 58, 55, 42, 38, 35, '', 'zhangyang'],
  ['mushun',    '穆顺', 60, 58, 40, 35, 38, '', 'zhangyang'],

  // ── 黑山军（张燕） ──
  ['zhangyan', '张燕', 78, 76, 62, 50, 55, 'tuji', 'zhangyan'],
  ['bairao',   '白饶', 62, 58, 45, 40, 40, '',     'zhangyan'],

  // ── 马腾军 ──
  ['mateng',  '马腾',  82, 80, 62, 58, 72, 'tuji',    'mateng'],
  ['machao',  '马超',  97, 88, 58, 40, 82, 'wushuang', 'mateng'],
  ['pangde',  '庞德',  88, 84, 62, 50, 58, 'tuji',    'mateng'],
  ['madai',   '马岱',  76, 74, 58, 50, 55, '',        'mateng'],
  ['hanmeng', '韩猛',  72, 66, 45, 38, 40, '',        'mateng'],

  // ── 韩遂军 ──
  ['hansui',        '韩遂', 72, 74, 72, 62, 60, 'jizhi', 'hansui'],
  ['yanxing',       '阎行', 84, 76, 55, 45, 48, 'tuji',  'hansui'],
  ['chenggongying', '成公英', 30, 60, 82, 72, 50, 'jizhi', 'hansui'],

  // ── 刘焉军 ──
  ['liuyan',  '刘焉',  40, 60, 78, 82, 80, 'shoucheng', 'liuyan'],
  ['liuzhang','刘璋',  30, 40, 45, 55, 60, '',         'liuyan'],
  ['zhangren','张任',  84, 82, 72, 58, 60, 'tiebi',    'liuyan'],
  ['yanyan',  '严颜',  82, 80, 62, 55, 60, 'tiebi',    'liuyan'],
  ['wuyi',    '吴懿',  74, 76, 60, 58, 55, '',         'liuyan'],
  ['fazheng', '法正',  25, 55, 92, 82, 55, 'jizhi',    'liuyan'],
  ['liyan',   '李严',  70, 74, 78, 72, 55, '',         'liuyan'],
  ['wuban',   '吴班',  70, 68, 50, 45, 45, '',         'liuyan'],
  ['zhanglu', '张鲁',  30, 55, 72, 70, 70, '',         'liuyan'],

  // ── 士燮军 ──
  ['shixie', '士燮', 40, 58, 72, 78, 72, 'shoucheng', 'shixie'],
  ['shiyi',  '士壹', 45, 50, 55, 55, 50, '',         'shixie'],
  ['oujing', '区景', 50, 48, 40, 38, 35, '',         'shixie'],

  // ── 刘繇军 ──
  ['liuyao',  '刘繇',  40, 52, 62, 65, 70, '',        'liuyao'],
  ['taishici','太史慈', 92, 86, 72, 60, 78, 'shenyi', 'liuyao'],
  ['zhangying','张英', 65, 62, 48, 42, 40, '',        'liuyao'],
  ['fanneng', '樊能',  58, 55, 38, 35, 32, '',        'liuyao'],
  ['yumi',    '于糜',  56, 54, 36, 34, 30, '',        'liuyao'],

  // ── 刘岱军 ──
  ['liudai', '刘岱', 42, 50, 58, 62, 65, '',      'liudai'],
  ['baoxin', '鲍信', 68, 70, 62, 58, 60, 'tiebi', 'liudai'],
  ['wanggong','王肱', 55, 55, 45, 45, 40, '',      'liudai'],

  // ── 孔伷军 ──
  ['kongzhou','孔伷', 35, 42, 58, 60, 62, '',      'kongzhou'],
  ['weizi',   '卫兹', 62, 64, 55, 60, 58, '',      'kongzhou'],
  ['fengfang','冯方', 40, 42, 48, 50, 45, '',      'kongzhou'],

  // ── 在野 ──
  ['liubei',     '刘备', 76, 80, 82, 88, 98, 'yangwei',  'free'],
  ['guanyu',     '关羽', 97, 90, 72, 62, 85, 'wushuang', 'free'],
  ['zhangfei',   '张飞', 98, 80, 45, 35, 65, 'wushuang', 'free'],
  ['huangzhong', '黄忠', 92, 86, 62, 55, 68, 'shenyi',   'free'],
  ['weiyan',     '魏延', 88, 82, 62, 45, 48, 'tuji',     'free'],
  ['ganning',    '甘宁', 90, 82, 62, 48, 60, 'tuji',     'free'],
  ['lusu',       '鲁肃', 45, 62, 88, 90, 78, 'jizhi',    'free'],
  ['zhoutai',    '周泰', 88, 74, 48, 42, 52, 'tiebi',    'free'],
  ['jiangqin',   '蒋钦', 78, 72, 52, 48, 48, 'shuijun',  'free'],
  ['chengong',   '陈宫', 40, 62, 88, 78, 62, 'jizhi',    'free'],
  ['tianchou',   '田畴', 30, 55, 78, 80, 62, '',         'free'],
  ['xushu',      '徐庶', 62, 70, 90, 78, 68, 'jizhi',    'free'],
  ['wangyun',    '王允', 25, 45, 82, 80, 72, '',         'free'],
  ['huangfusong','皇甫嵩', 82, 90, 78, 72, 80, 'tiebi',  'free'],
  ['zhujun',     '朱儁', 80, 86, 72, 68, 72, 'xianzhen', 'free'],
  ['luzhi',      '卢植', 70, 84, 85, 80, 82, 'tiebi',    'free'],
  ['chenlin',    '陈琳', 15, 35, 82, 78, 62, '',         'free'],
  ['huatuo',     '华佗', 10, 20, 85, 60, 70, 'jizhi',    'free'],
];

// 特技效果表 —— 在战斗 / 内政中读取
const HERO_SKILLS = {
  jianxiong: { name: '奸雄', desc: '全军攻防 +8%', atk: 1.08, def: 1.08 },
  wushuang:  { name: '无双', desc: '全军攻击 +20%，自身受伤概率提高', atk: 1.20, def: 0.95 },
  tuji:      { name: '突击', desc: '骑兵攻击 +15%', cavalry: 1.15 },
  tiebi:     { name: '铁壁', desc: '守城防御 +20%', defenseCity: 1.20 },
  shenyi:    { name: '神射', desc: '弓兵攻击 +15%', archer: 1.15 },
  xianzhen:  { name: '陷阵', desc: '步兵攻击 +15%', infantry: 1.15 },
  huoji:     { name: '火计', desc: '攻城伤害 +20%，敌全军防御 -8%', siege: 1.20, enemyDef: 0.92 },
  jizhi:     { name: '急智', desc: '敌方全军攻击 -10%', enemyAtk: 0.90 },
  yangwei:   { name: '扬威', desc: '全军士气 +15%', morale: 1.15 },
  shoucheng: { name: '守成', desc: '本城产出 +10%', economy: 1.10 },
  shuijun:   { name: '水战', desc: '水军攻击 +25%', navy: 1.25 },
};

function skillOf(hero) {
  return HERO_SKILLS[hero && hero.skill] || {};
}
