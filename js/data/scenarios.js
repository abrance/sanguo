// 剧本注册表。多剧本平行 —— 每个剧本独立存档、独立状态。
const SCENARIOS = {
  taodong190: {
    id: 'taodong190',
    name: '讨董卓',
    subtitle: '初平元年（190）· 关东诸侯起兵',
    year: 190,
    month: 1,
    cityRows: CITY_ROWS,
    heroRows: HERO_ROWS,
    factionRows: FACTION_ROWS,
    // 可玩势力（小势力也开放，玩家可体验弱主开局）
    playable: FACTION_ROWS.map(r => r[0]),
    desc: '董卓挟天子迁都长安，关东诸侯会盟讨伐。你是乱世中的一城之主 —— 效忠一方、积攒战功、步步高升，或者……自立门户。',
  },
};

const DEFAULT_SCENARIO = 'taodong190';

function getScenario(id) {
  return SCENARIOS[id || DEFAULT_SCENARIO];
}
