// 官渡 200 · 城池表：与讨董共用同一张地理底图
//
// 只覆写「200 年的初始等级」：中原屡经战乱，城防与人口比 190 年更厚；
// 具体数值差异集中写在这里，别去改讨董那份数据。
const GUANDU200_CITY_ROWS = TAODONG190_CITY_ROWS.map(r => {
  const [id, name, x, y, terrain, region, pop, farm, market, wall] = r;
  const popMul = ['司隶', '兖州', '豫州', '冀州'].indexOf(region) >= 0 ? 1.1 : 1.0;
  const wallBonus = ['ye', 'xuchang', 'luoyang', 'changan'].indexOf(id) >= 0 ? 1 : 0;
  return [id, name, x, y, terrain, region,
    Math.round(pop * popMul), farm, market, Math.min(4, wall + wallBonus)];
});
