// 外交数据：状态文案与行动定义（UI 与校验共用一份）

const DIPLO_STATUS = {
  war:     { name: '交战', color: '#c85a4a', desc: '可出兵攻其城池' },
  neutral: { name: '中立', color: '#9a8c76', desc: '不可攻；攻之即为背刺' },
  truce:   { name: '停战', color: '#c9a227', desc: '停战期内不可攻' },
  ally:    { name: '同盟', color: '#5f9a6a', desc: '互不攻；盟友被攻时可能来援' },
};

// 个人外交（任何官阶都能做，花自己直辖城的钱）
const PERSONAL_ACTIONS = {
  envoy: { name: '遣使修好', cost: 300,  need: 0,  desc: '目标势力与我方关系 +6' },
  pact:  { name: '私通密约', cost: 800,  need: 0,  desc: '12 月内该势力不攻你直辖城（30% 被告发）' },
  aid:   { name: '求援',     cost: 1000, need: 20, desc: '该势力派兵并入你首城守军' },
  grain: { name: '借粮',     cost: 600,  need: 10, desc: '该势力赠粮入你首城' },
  bribe: { name: '行贿上级', cost: 500,  need: 0,  desc: '上级好感 +12（15% 被同僚检举）' },
};

// 上表（州牧+）与代君行令（三公+ / 自立）提案
const DIPLO_PROPOSALS = {
  war:      { name: '宣战', cost: 800,  favor: 10, desc: '请君主对某国用兵' },
  peace:    { name: '求和', cost: 600,  favor: 6,  desc: '请君主与交战国罢兵' },
  ally:     { name: '结盟', cost: 1000, favor: 12, desc: '请君主与某国结盟（需关系 40）' },
  intrigue: { name: '离间', cost: 1500, favor: 8,  desc: '挑拨某国与其强邻，两国关系 −20' },
};

const DIPLO_LAYERS = {
  personal: { name: '个人外交', desc: '官未至州牧：只能以私人身份结交他国，干的是自己的城、花的是自己的钱。' },
  petition: { name: '上表言事', desc: '州牧以上：可向君主提议宣战 / 求和 / 结盟 / 离间，采纳与否由君主裁定。' },
  direct:   { name: '代君行令', desc: '三公或自立之主：直接以国家名义行事，每次动权柄都会招君主猜忌。' },
};
