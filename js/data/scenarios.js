// 剧本注册表。多剧本平行 —— 每个剧本独立存档、独立状态。
//
// 新增剧本的约定：数据文件放 js/data/scenarios/<剧本id>/，顶层符号必须带剧本 id 前缀
// （如 TAODONG190_CITY_ROWS）。全局作用域没有模块隔离，不带前缀就会和别的剧本撞名。

/** 在野伪势力：不属于任何一家，城池可随时攻打。跨剧本共用，不是剧本数据。 */

const SCENARIOS = {
  taodong190: {
    id: 'taodong190',
    name: '讨董卓',
    subtitle: '初平元年（190）· 关东诸侯起兵',
    year: 190,
    month: 1,
    cityRows: TAODONG190_CITY_ROWS,
    heroSkills: TAODONG190_HERO_SKILLS,
    heroRows: TAODONG190_HERO_ROWS,
    factionRows: TAODONG190_FACTION_ROWS,
    ambitions: TAODONG190_AMBITIONS,
    rivals: TAODONG190_RIVALS,
    // 可玩势力（小势力也开放，玩家可体验弱主开局）
    playable: TAODONG190_FACTION_ROWS.map(r => r[0]),
    emperorCityId: 'luoyang',
    desc: '董卓挟天子迁都长安，关东诸侯会盟讨伐。你是乱世中的一城之主 —— 效忠一方、积攒战功、步步高升，或者……自立门户。',
  },

  guandu200: {
    id: 'guandu200',
    name: '官渡之战',
    subtitle: '建安五年（200）· 曹袁相持于官渡',
    year: 200,
    month: 2,
    cityRows: GUANDU200_CITY_ROWS,
    heroSkills: TAODONG190_HERO_SKILLS,   // 特技表跨剧本共用
    heroRows: GUANDU200_HERO_ROWS,
    factionRows: GUANDU200_FACTION_ROWS,
    ambitions: GUANDU200_AMBITIONS,
    rivals: GUANDU200_RIVALS,
    playable: GUANDU200_FACTION_ROWS.map(r => r[0]),
    emperorCityId: 'xuchang',
    desc: '曹操迎天子于许，袁绍并河北四州，两家相拒于官渡。你是乱世中的一城之主 —— 押注曹袁，或趁乱自立。',
  },
};

const FREE_FACTION = {
  id: 'free', name: '在野', color: '#c8b58a', rulerId: null, aggression: 0,
  cities: [],
};

const DEFAULT_SCENARIO = 'taodong190';

function getScenario(id) {
  return SCENARIOS[id || DEFAULT_SCENARIO] || SCENARIOS[DEFAULT_SCENARIO];
}

/** 特技定义按剧本查（技能表不跨剧本共用）；缺表时返回空对象，调用方按 1 倍处理 */
function heroSkill(G, key) {
  return (getScenario(G && G.meta && G.meta.scenarioId).heroSkills || {})[key] || {};
}

function skillOf(G, hero) {
  return heroSkill(G, hero && hero.skill);
}
