// 讨董剧本 · 大势：各势力在特定时段的既定攻打对象（剧本骨架）
// 行格式: 势力id: [ [目标势力id, 起回合, 止回合, 缘由, 必战?], ... ]
//   - 回合是绝对回合数（开局 = 1，一回合 = 一月）
//   - 时间窗内该势力对外只有一个念头，关系会被压到开战线以下
//   - 必战 (sure: true) 不受"强弱"门槛限制 —— 历史上必打的那几仗
// 没有野心表的势力按原随机逻辑行事。
const TAODONG190_AMBITIONS = {
  // 董卓：关东兵起，先剪肘腋（河内王匡、南阳袁术），再议迁都
  dongzhuo: [
    ['zhangyang', 2, 3, '关东兵起，先剪河内肘腋', true],
    ['yuanshu', 2, 3, '南阳袁术为关东盟主，奉诏讨之', true],
    ['hanfu', 2, 3, '韩馥据冀州，为关东粮道', true],
  ],

  // 袁绍：取冀州 → 界桥 → 南下
  yuanshao: [
    ['hanfu', 2, 3, '会盟讨董，冀州当为盟主供粮', true],
    ['hanfu', 3, 20, '冀州殷富，绍欲取之为基业'],
    ['gongsunzan', 22, 46, '界桥之后，河北只容一家'],
    ['caocao', 30, 60, '河北既定，当南下争兖州'],
  ],

  // 公孙瓒：幽州旧怨 → 界桥
  gongsunzan: [
    ['dongzhuo', 2, 3, '白马义从奉诏入关讨董', true],
    ['liuyu', 10, 28, '刘虞怀柔，碍我铁骑南下'],
    ['yuanshao', 18, 46, '袁绍窃据冀州，势不两立'],
  ],

  // 曹操：讨董 → 徐州 → 淮南
  caocao: [
    ['dongzhuo', 2, 3, '首倡义兵，会盟讨董', true],
    ['taoqian', 8, 28, '徐州牧纵兵掠我境，讨之'],
    ['yuanshu', 28, 56, '袁术僭号淮南，奉诏讨逆'],
  ],

  // 陶谦：不想打，但曹操压境就得还手
  taoqian: [
    ['caocao', 8, 28, '曹军压境，先发制人'],
  ],

  // 袁术：南阳 → 淮南 → 图徐州
  yuanshu: [
    ['dongzhuo', 2, 3, '奉盟主之命讨董', true],
    ['liubiao', 6, 26, '南阳钱粮之争，荆襄可图'],
    ['kongzhou', 26, 54, '豫州空虚，取之以图中原'],
  ],

  // 孙坚：讨董 → 报襄阳之仇
  sunjian: [
    ['dongzhuo', 2, 3, '受袁术之命西讨董卓', true],
    ['liubiao', 4, 24, '襄阳之仇，必报'],
  ],

  // 刘表：守荆襄
  liubiao: [
    ['sunjian', 4, 24, '孙坚越境掠我郡县'],
    ['yuanshu', 8, 30, '袁术据南阳，窥我荆襄'],
  ],

  // 刘焉：益州门户
  liuyan: [
    ['liubiao', 15, 44, '荆州扼我东门，当先取之'],
  ],

  // 凉州二雄互噬
  mateng: [['hansui', 4, 22, '凉州只容一雄']],
  hansui: [['mateng', 4, 22, '马腾骄横，先剪其锋']],

  // 黑山军：东出太行
  zhangyan: [
    ['hanfu', 4, 20, '东出太行，略冀州粮仓'],
    ['yuanshao', 10, 34, '袁绍屡讨黑山，与之相攻'],
  ],

  // 刘虞：白马将军跋扈
  liuyu: [['gongsunzan', 10, 28, '公孙瓒纵兵掠民，忍无可忍']],

  // 韩馥：冀州守成，但关东会盟要跟
  hanfu: [['dongzhuo', 2, 3, '冀州牧从盟主讨董', true]],

  // 孔融、刘繇、士燮、刘岱、孔伷、张杨、公孙度：小势力，只守不攻
};

// 天下宿敌：不成文的旧怨，关系每月自然结冰 → 打不完的仗
const TAODONG190_RIVALS = [
  ['yuanshao', 'gongsunzan'], ['yuanshao', 'zhangyan'], ['yuanshao', 'caocao'],
  ['caocao', 'taoqian'], ['caocao', 'yuanshu'], ['caocao', 'liudai'],
  ['yuanshu', 'liubiao'], ['yuanshu', 'caocao'], ['sunjian', 'liubiao'],
  ['liuyan', 'liubiao'], ['mateng', 'hansui'], ['gongsunzan', 'liuyu'],
  ['liuyao', 'sunjian'], ['kongrong', 'caocao'], ['dongzhuo', 'yuanshao'],
  ['dongzhuo', 'caocao'], ['dongzhuo', 'yuanshu'], ['dongzhuo', 'sunjian'],
  ['zhangyan', 'hanfu'], ['liudai', 'kongzhou'],
];
