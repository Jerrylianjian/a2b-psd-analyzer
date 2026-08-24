# A2B TX PSD Analyzer

浏览器端 CSV 波形转 PSD 工具，参考 `../Matlab/calculate_psd_testmode3.m` 的 Welch PSD 流程，并叠加 A2B 发送信号功率谱密度限值。

## 输入格式

- 两列 CSV/TXT/DAT：`time_s, voltage_v`
- 单列 CSV：`voltage_v`，需要在界面填写采样率 `Fs`
- 两列示波器 CSV 会自动从时间列计算 `Fs`，界面的 `Fs` 输入只作为单列 CSV 的备用值
- 支持逗号、Tab、分号、空格分隔；表头和注释行会自动跳过

## PSD 计算

- 全局去均值
- Hann window
- 50% overlap
- `windowLength = min(65536, 2^floor(log2(max(256, floor(N/8)))))`
- 输出 `V^2/Hz`、`dB/Hz`、`dBm/Hz`、`dBm/RBW`
- 可切换 50 Ω / 100 Ω 参考负载
- 可设置 RBW，按 `dBm/RBW = dBm/Hz + 10log10(RBW_Hz)` 换算
- 可选择高/中/低驱动能力限值，并检查上限和 5 MHz 到 80 MHz 的下限窗口
- `a2b_psd_limits.csv` 保存了图片表格中的限值点

## 使用

直接用浏览器打开 `index.html`，上传 CSV 后点击 `RUN ANALYSIS`。

也可以在当前目录启动本地服务器：

```sh
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`。

## GitHub Pages

发布到 GitHub Pages 时，只需要仓库根目录包含：

- `index.html`
- `app.js`
- `styles.css`
- `a2b_psd_limits.csv`
- `.nojekyll`

在 GitHub 仓库设置里打开 `Settings -> Pages -> Deploy from a branch`，选择 `main / root`。
