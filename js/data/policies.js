// 士族与施政方针

// 士族姓氏池（按地域大致分配，实际随机抽取）
const CLAN_NAMES = [
  '颍川荀氏', '颍川钟氏', '弘农杨氏', '汝南袁氏', '汝南许氏', '河内司马氏',
  '太原王氏', '琅邪王氏', '琅邪诸葛氏', '陈留蔡氏', '北海孙氏', '吴郡顾氏',
  '吴郡陆氏', '吴郡朱氏', '吴郡张氏', '会稽虞氏', '会稽周氏', '襄阳蒯氏',
  '襄阳蔡氏', '南阳阴氏', '南阳邓氏', '扶风法氏', '京兆韦氏', '安定皇甫氏',
  '敦煌索氏', '益州张氏', '巴郡严氏', '涿郡卢氏', '清河崔氏', '范阳卢氏',
  '河间邢氏', '渤海高氏', '平原华氏', '泰山羊氏', '济阴卞氏', '谯郡夏侯氏',
  '沛国曹氏', '庐江周氏', '零陵赖氏', '交阯士氏', '太原郭氏', '河东卫氏',
  '陈郡谢氏', '太原温氏', '京兆杜氏', '扶风马氏', '陇西李氏', '天水赵氏',
];

// 施政方针：不手动管的时候，太守按此自动理政
const POLICIES = {
  farm: {
    id: 'farm', name: '重农',
    desc: '优先农田、粮仓、伐木采石，轻兵。府库优先积粮。',
    buildOrder: ['farm', 'granary', 'lumber', 'quarry', 'office', 'clinic'],
    recruitRatio: 0.45,
  },
  army: {
    id: 'army', name: '备战',
    desc: '优先兵营、校场、马场、冶铁，征兵至八成兵额。',
    buildOrder: ['barracks', 'drill', 'stable', 'ironworks', 'wall', 'academy'],
    recruitRatio: 0.85,
  },
  trade: {
    id: 'trade', name: '商贸',
    desc: '优先市集、关市、府衙、学宫，积累钱粮与科研。',
    buildOrder: ['market', 'academy', 'customs', 'office', 'granary', 'clinic'],
    recruitRatio: 0.75,
  },
  wall: {
    id: 'wall', name: '筑城',
    desc: '优先城墙、烽燧、船坞、医馆，求稳守土。',
    buildOrder: ['wall', 'beacon', 'shipyard', 'drill', 'granary', 'office'],
    recruitRatio: 0.7,
  },
  balanced: {
    id: 'balanced', name: '均衡',
    desc: '按缺口均衡发展，什么缺补什么。',
    buildOrder: ['farm', 'market', 'academy', 'barracks', 'wall', 'office', 'granary'],
    recruitRatio: 0.75,
  },
};

const POLICY_KEYS = Object.keys(POLICIES);

// 士族满意度基准
function clanBaseline(c, bonuses) {
  const office = bldValue(c, 'office');
  const beacon = bldValue(c, 'beacon');
  const granary = bldValue(c, 'granary');
  return 40 + office * 2 + beacon * 1.0 + granary * 1.0;
}
