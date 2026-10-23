// 官渡 200 · 大势：各势力在特定时段的既定攻打对象（剧本骨架）
// 行格式：势力id: [[目标势力id, 起回合, 止回合, 缘由, 必战?], ...]
const GUANDU200_AMBITIONS = {
  // 袁绍：白马 → 延津 → 官渡，久攻不下后转守
  yuanshao: [
    ['caocao', 1, 24, '奉衣带诏之名南下，白马延津连战', true],
    ['caocao', 25, 48, '官渡相持，粮道为要'],
    ['zhangyan', 50, 80, '河北既失，退保太行'],
  ],
  // 曹操：官渡死守，之后反攻河北
  caocao: [
    ['yuanshao', 1, 48, '官渡相拒，寸土不让', true],
    ['yuanshao', 49, 90, '乌巢火起，乘胜北进'],
    ['liubiao', 60, 100, '荆襄窥我后方，先发制人'],
  ],
  // 孙策：定江东 → 西击黄祖
  sunce: [
    ['liubiao', 4, 30, '报襄阳之仇，西击黄祖', true],
    ['caocao', 40, 70, '乘曹袁相持，北窥合肥'],
  ],
  liubiao: [
    ['sunce', 6, 30, '孙氏屡犯江夏'],
    ['caocao', 40, 80, '北方既分，荆襄自守'],
  ],
  liuzhang: [['zhanglu', 6, 30, '张鲁据汉中，北门之忧']],
  zhanglu: [['liuzhang', 8, 40, '益州暗弱，可取也']],
  mateng: [['caocao', 20, 60, '奉诏讨曹，关中震动']],
  hansui: [['mateng', 10, 40, '凉州旧怨']],
  zhangyan: [['yuanshao', 30, 70, '袁氏北撤，黑山可出']],
};

// 宿敌：每对初始关系压低，摩擦更快
const GUANDU200_RIVALS = [
  ['yuanshao', 'caocao'],
  ['sunce', 'liubiao'],
  ['liuzhang', 'zhanglu'],
  ['mateng', 'caocao'],
  ['hansui', 'mateng'],
  ['zhangyan', 'yuanshao'],
];
