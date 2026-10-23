// 官渡（建安五年 200）势力表
// 行格式：[id, 名称, 颜色, 君主武将id, 侵略性, [城池id...]]
// 与讨董剧本的差别：董卓 / 袁术 / 公孙瓒 / 陶谦 / 刘繇 / 刘焉 / 韩馥等已亡，
// 孙策据江东、刘璋继益州、曹操迎驾于许，袁绍并河北四州 —— 天下只剩十一家。
const GUANDU200_FACTION_ROWS = [
  ['caocao',    '曹操军',   '#2f6f9f', 'caocao',    0.70,
    ['chenliu', 'puyang', 'xuchang', 'liangguo', 'chenguo', 'peiguo', 'dongping',
      'taishan', 'jibei', 'pengcheng', 'xiapi', 'donghai', 'guangling', 'luoyang', 'hongnong']],
  ['yuanshao',  '袁绍军',   '#b8860b', 'yuanshao',  0.65,
    ['ye', 'julu', 'qinghe', 'bohai', 'hejian', 'pingyuan', 'zhuojun', 'youbeiping',
      'liaoxi', 'zhongshan', 'changshan', 'taiyuan', 'shangdang', 'yanmen', 'xihe', 'shangjun']],
  ['liubiao',   '刘表军',   '#2e7d5b', 'liubiao',   0.30,
    ['xiangyang', 'jiangling', 'jiangxia', 'wuling', 'guiyang', 'changsha', 'lingling', 'nanyang']],
  ['sunce',     '孙策军',   '#c0392b', 'sunce',     0.65,
    ['wujun', 'kuaiji', 'danyang', 'yuzhang', 'lujiang']],
  ['liuzhang',  '刘璋军',   '#7a5c12', 'liuzhang',  0.20,
    ['chengdu', 'guanghan', 'bajun', 'qianwei', 'jianning']],
  ['zhanglu',   '张鲁军',   '#8a6a2f', 'zhanglu',   0.25, ['hanzhong']],
  ['mateng',    '马腾军',   '#a67c00', 'mateng',    0.40, ['tianshui', 'longxi', 'anding', 'fengyi']],
  ['hansui',    '韩遂军',   '#6a4fa0', 'hansui',    0.35, ['jincheng', 'wuwei', 'jiuquan']],
  ['gongsundu', '公孙度军', '#456a8b', 'gongsundu', 0.20, ['liaodong']],
  ['shixie',    '士燮军',   '#4a7a4a', 'shixie',    0.10, ['jiaozhi', 'cangwu', 'nanhai']],
  ['zhangyan',  '黑山军',   '#5f574a', 'zhangyan',  0.30, ['henei']],
];
