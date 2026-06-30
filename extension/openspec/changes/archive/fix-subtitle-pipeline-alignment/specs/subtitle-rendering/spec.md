## ADDED Requirements

### Requirement: 广告插入时字幕立即隐藏

系统 SHALL 在 `renderLoop` 检测到 `isAdShowing()` 为真时，立即移除字幕容器的 `visible` 类并清空 `innerHTML`，不进入 gap-hold 判断、不依赖 `renderCue(-1)` 的一次性触发假设。广告期间系统 MUST NOT 在画面上显示任何字幕。

#### Scenario: 播放中插入广告字幕消失

 WHEN 视频正在播放且当前显示 cue #5，YouTube 播放器切换到广告（`ad-showing` 类添加）
 THEN `renderLoop` 下一帧检测到 `isAdShowing()=true`
 AND 立即执行 `container.classList.remove('visible')` + `container.innerHTML=''`
 AND 不调用 `renderCue(-1)`、不进入 gap-hold
 AND 字幕从画面上立即消失。

#### Scenario: 广告结束后字幕恢复

 WHEN 广告结束（`ad-showing` 类移除），`video.currentTime` 落在 cue #7 的范围内
 THEN `renderLoop` 下一帧 `isAdShowing()=false`，`findCueIndex` 返回 7
 AND `renderCue(7)` 正常渲染 cue #7
 AND 字幕恢复显示。

### Requirement: seek 跳变时字幕立即隐藏

系统 SHALL 在 `video` 触发 `seeking` 事件时，立即把 `renderer._lastValidIndex` 置为 -1，使 gap-hold 失去 hold 依据。系统 SHALL 同时监听 `seeked` 事件作为兜底（防 `seeking` 不触发的场景）。seek 后若新位置无字幕，字幕 MUST 立即隐藏；若新位置有字幕，MUST 立即显示对应 cue。

#### Scenario: seek 到无字幕区字幕消失

 WHEN 视频正在显示 cue #10，用户拖动进度条到时间点 T，T 处无任何 cue（`findCueIndex(T)=-1`）
 THEN `seeking` 事件触发，`_lastValidIndex` 被置为 -1
 AND `renderLoop` 下一帧 `findCueIndex` 返回 -1
 AND `renderCue(-1)` 的 gap-hold 因 `_lastValidIndex=-1` 跳过 hold
 AND 字幕立即隐藏，不再残留 cue #10 的内容。

#### Scenario: seek 到有字幕区字幕切换

 WHEN 用户 seek 到时间点 T，T 落在 cue #20 范围内
 THEN `seeking` 触发 `_lastValidIndex=-1`
 AND `renderLoop` 下一帧 `findCueIndex(T)=20`
 AND `renderCue(20)` 渲染 cue #20，`_lastValidIndex` 更新为 20
 AND 字幕立即切换到 cue #20。

#### Scenario: seeked 兜底

 WHEN 某场景下 `seeking` 事件未触发但 `seeked` 触发，用户 seek 到无字幕区
 THEN `seeked` 回调把 `_lastValidIndex` 置为 -1
 AND `renderLoop` 下一帧隐藏字幕。

### Requirement: gap-hold 仅在自然播放短间隙生效

系统 SHALL 仅在以下条件全部满足时执行 gap-hold（保持显示上一句字幕不隐藏）：
- `isAdShowing()` 为假。
- 未发生 seek（`_lastValidIndex >= 0`）。
- 下一 cue 的 start 距当前 `video.currentTime` < `SUBTITLE_GAP_HOLD_SEC`（2.0s）。

任一条件不满足时，系统 MUST 立即隐藏字幕（移除 `visible` 类并清空 `innerHTML`），不执行 hold。

#### Scenario: 自然播放短间隙保持显示

 WHEN 视频自然播放，cue #5 显示结束（currentTime 超过 cue #5.end），下一 cue #6 的 start 距 currentTime 1.2s（<2.0s），`isAdShowing()=false`，`_lastValidIndex=5`
 THEN `renderCue(-1)` 进入 gap-hold，三个条件全满足
 AND 保持显示 cue #5，不隐藏
 AND 1.2s 后 cue #6 自然接续，无闪烁。

#### Scenario: 自然播放长间隙正常隐藏

 WHEN 视频自然播放，cue #5 显示结束，下一 cue #6 的 start 距 currentTime 3.5s（>2.0s），`isAdShowing()=false`
 THEN gap-hold 条件不满足（waitSec >= 2.0）
 AND 立即隐藏字幕
 AND 3.5s 后 cue #6 正常显示。

#### Scenario: 广告期间不进入 gap-hold

 WHEN `isAdShowing()=true`，`renderCue(-1)` 被调用
 THEN gap-hold 入口判定 `isAdShowing()` 为真，跳过 hold
 AND 立即隐藏字幕。

### Requirement: renderLoop 每帧重新评估状态

系统 SHALL NOT 依赖「调用一次 `renderCue(-1)` 即肯定隐藏」的假设。`renderLoop` 每帧 MUST 重新计算 `findCueIndex(currentTime)` 并与 `currentCueIndex` 比较，当状态不一致时重新调用 `renderCue`。这确保 gap-hold 或其他路径未能隐藏字幕时，后续帧能自动纠正。

#### Scenario: gap-hold 未能隐藏后自动纠正

 WHEN 某帧 `renderCue(-1)` 因 gap-hold 未能隐藏字幕（不应发生但作为兜底），且下一帧 `findCueIndex` 仍返回 -1 且 gap-hold 条件不再成立
 THEN `renderLoop` 检测到 `cueIndex=-1 !== currentCueIndex=-1`（当前已是 -1 但字幕仍可见）
 AND 重新调用 `renderCue(-1)`，本次 gap-hold 条件不成立，字幕被隐藏
 AND 状态自动纠正，不再死锁。

#### Scenario: currentCueIndex 一致时不重复渲染

 WHEN 连续多帧 `findCueIndex` 返回相同的 cue 索引
 THEN `renderLoop` 不重复调用 `renderCue`（`cueIndex === currentCueIndex` 跳过）
 AND 无性能浪费。
