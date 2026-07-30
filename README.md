# 股指期货基差监控 · 公共 HTML

这是只读 GitHub Pages 网页，只包含 HTML、CSS、JavaScript 和脱敏行情 JSON。

数据来源：

- 普通行情及普通年化升贴水率：Wind 本地授权数据库日频收盘；
- 期内分红及年化升贴水率（剔除期内分红）：
  [Tinysoft 指数分红预测页面](https://web.tinysoft.com.cn/website/index.tsl?PageID=27433)。

业务口径：

- 基差＝期货－现货；
- 负数表示贴水；
- 不取绝对值；
- 剔除期内分红指标完整使用 Tinysoft 同一快照，不由 Wind 补算或覆盖。

本仓库不应包含 Wind/Tinysoft 凭据、本地配置或 SQLite 数据库。
