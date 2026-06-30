## 1. 长句切分标点优先（D3）

- [x] 1.1 在 `youtube-subtitles.js` `segmentSentences` 的长句切分步骤（当前 `duration > MAX_SENTENCE_DURATION_SEC` 分支），改切分点选择逻辑：优先找 `sent[q].text` 以 `.?!。？！` 结尾的 q（q < len-1），选最接近句子中点（`length/2`）的那个 q，在该 q 之后切分。
- [x] 1.2 若整段无句末标点切分点，保留现有"最大词间间隔"切分逻辑作为退化路径。
- [x] 1.3 跑 `test_pipeline.js` 53 个测试，确认长句切分改动无回归。

## 2. 翻译单元完整性安全网（D1, D2）

- [x] 2.1 在 `segmentSentences` 末尾、`return sentences` 前，新增安全网后处理循环：遍历最终 sentences，对不以 `.?!。？！` 结尾的 `S[i]`，若 `S[i+1]` 存在且 `gap = S[i+1].start - S[i].end` 满足 `0 <= gap < 1.0`（秒），且合并后 duration `= S[i+1].end - S[i].start < 15.0`（秒），且 `gap <= 2.0`（非大间隔硬切），则把 `S[i]` 前向合并到 `S[i+1]`（`S[i+1].text = S[i].text + ' ' + S[i+1].text`，`S[i+1].start = S[i].start`），移除 `S[i]`。
- [x] 2.2 合并后回退索引重新检查新 `S[i]` 位置（链式合并：合并结果可能仍无标点，需继续往前看）。
- [x] 2.3 安全网只处理无句末标点结尾的句子，不触碰以 `.?!。？！` 结尾的完整句。
- [x] 2.4 跑 `test_pipeline.js` 53 个测试，确认安全网无回归（词级 json3 路径触发率极低）。

## 3. 极端 case WARN 日志（D4）

- [x] 3.1 安全网循环结束后，扫描最终 sentences，对仍不以 `.?!。？！` 结尾的句子，`debugLog('YT-Subs', 'segmentSentences: incomplete sentence remains at #' + i + ': ' + text.slice(0, 60))`。
- [x] 3.2 不中断处理，继续返回 sentences。

## 4. 回归验证

- [x] 4.1 用 `extension/log/f (2).txt` 跑完整流水线，对比 `subtitle-pipeline-log (3).txt`：`#56`+`#57` 合并为一句不再切开；24 个无标点结尾 case 数量降到接近 0；翻译从 #57 起不错位（译文与原文对齐）。
  - 注：分段层用 `test_safynet_regression.js` 验证 — #56+#57 在输出 #54 合并为以 `.` 结尾的完整句；无标点结尾从 24→5（残留 5 个均为 mergedDur≥15s 的极端 case，安全网按设计不合并）。AI 翻译对齐层依赖线上 AI 后端，由"不送半句话给 AI"这一前置不变量保证。
- [x] 4.2 验证安全网不误合并 gap>1s 的语义停顿句、不合并超 15s 的超长对、不触碰完整句。
  - `test_safynet_regression.js`：max duration 14.92s < 15s；5 残留全部 unmergeable；完整句计数自洽。
- [x] 4.2b（源审计）：用 `test_log_crosscheck.js` 对 f(3).txt（源 json3）↔ subtitle-pipeline-log (4).tx 交叉校验：3046 源词 → 3046 输出词 0% 丢失，0 幻觉，284=284 1:1 对齐，5 残留全部 ASR 源头缺标点符合设计拒绝条件。
- [x] 4.3 运行 `openspec validate fix-translation-misalignment-safety-net` 通过。
