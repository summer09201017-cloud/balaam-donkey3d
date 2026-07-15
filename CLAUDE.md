# CLAUDE.md — balaam-donkey3d(巴蘭騎驢 3D,民數記 22:21-33 聖經皮)

> 2026-07-16 建成:**fork 自 donkey-jerusalem3d**(騎驢進耶路撒冷),照 mount-riding-kit 換皮。
> ★玩家=**驢**(民22:21-33)——全場「唯一看得見耶和華的使者站在路上、手裡有拔出來的刀」的角色;
> 巴蘭(騎在背上的先知)看不見,驢避讓慢了就挨巴蘭的杖(演出溫柔化:揮杖+驢委屈搖頭,不血腥)。
> 經文已用 mcp cuv lookup 逐節查驗(和合本):民22:28、民22:31、民22:33,一字不改。

## 引擎核心(換皮時沒動的)

- `buildCourse/posAt/tangentAt`:CatmullRom 閉環賽道,一切以「里程 dist」為域。
- `jump()` 判定=畫面:`err=|distToFence-TAKEOFF_D|/speed`,`quality=1-err/(window*2.2)`
  (skijump 綠區同款);按下當下定「及時避讓/挨打」,巴蘭的杖在判定後才揮下。
- 溫柔規則:沒按=auto weak jump(quality 0.18),永不會輸——再多罰分也走得完。
- `this.running` 只給 RAF(athletics 撞名事故鐵則)。

## 這個皮的語意對照(判定不動,只換語意)

- 欄架 → **天使站**:每站一位 `makeAngel`(白袍+光暈 Sphere+光環+雙翼 Plane+發亮的刀,
  浮動+光暈脈動由 update 驅動)站在路中——場上沒有群眾,只有驢看得見祂。
- 站分**三幕**照經文順序(`fence.act`):前 1/3=田間寬路(路旁綠斑,民22:23)、
  中 1/3=葡萄園窄路(兩側矮石牆+牆外葡萄藤,民22:24)、後 1/3=極窄之處(兩側高石壁,民22:26)。
  三幕場景由 `buildActScenery()` 沿賽道里程鋪設,避讓文案照幕輪換(轉入田間/貼牆/臥下)。
- 乾淨過=及時避讓(天使光暈柔和一閃);擦標=「驢遲疑,巴蘭的杖落下」+4 罰分
  (`beatT` 巴蘭右臂揮杖兩下+`headShakeT` 驢委屈搖頭低頭+踉蹌減速)。
- **防穿模鐵則(07-16 插單拍板,驢絕不從天使身上穿過)**:雙管齊下——
  ①天使站一律低姿 `makeAngel({pose:"low"})`:半跪+rig 下沉 0.55+整體 0.72、雙翼橫展、
  光環貼頭、刀前斜,含刀含光環總高 ≈1.35 世界單位;
  ②乾淨避讓=高弧 `height=1.6+q*0.5` 且 `jumpY()` 弧峰對齊交會點(k0=起跳距站/跳程)——
  交會當下 jumpY=height ≥1.85,實測最小淨空 +0.54;
  ③低弧(弱跳/沒按)交會=**天使閃身讓開** 1.2 單位+白光一閃(民22 使者的主動性),
  `f.dodge01` lerp `delta*14`、|df|<2.8 觸發,過後回位——低弧也零穿模,挨打演出照舊。
  終局大天使 `pose:"stand"`(驢已停步不交會)。驗證:凍結幀截圖 bd-noclip-clean/bd-noclip-dodge。
- **終局演出**(`phase="finale"`,3.4 秒,民22:31):大天使現形路中+全場天使增亮+
  巴蘭漸漸俯伏(`rider.rig.rotation.x`)+鏡頭硬切側前方,然後才進結算 overlay。
- 結算:零罰分=「驢兒忠心!牠救了主人的命」+民22:33;有罰分=民22:28(驢開口)。
- 模式只有兩個:`standard` 巴蘭之路 / `practice` 練習小路。
- `makeDonkey` 原封保留(灰褐/深灰/淺棕三檔);巴蘭=`makeBalaamRider`
  (土黃/褐袍+頭巾+深色大鬍+右手木杖掛 `rightArm.joint`),坐姿 group y=0.62,掛 horse.rig。
- 場景:摩押曠野(乾土原+遠山+稀疏橄欖樹);已移除:耶路撒冷城牆城門、棕櫚樹、群眾與觀眾席。

## 語音(人聲鐵律:預烤 mp3,不用 Web Speech)

- `voicePhrases.js`:PHRASES 12 句(雲哲旁白)+SCRIPTURES 3 節(曉臻,民22:28/31/33,cuv 查驗原文)。
- 結算引經文:零罰分唸民22:33、有罰分唸民22:28(main.js finish case);
  finale 事件唸短句「天使現形了!巴蘭俯伏在地!」(民22:31 全文以字幕呈現,避免被結算語音截斷)。
- 重烤:`node scripts/gen-voice.mjs`(需網路;產物進 git,離線可玩)。

## identity

package name `balaam-donkey3d`;SW cache `balaam-donkey3d-nf1`;storage 鍵 `balaam-donkey3d-*`;
dev hook `window.__balaamDonkey3d`(+通用 `window.__game`);icon=驢馱巴蘭+天使剪影+刀光(深藍底)。

## 本機地雷(承母體)

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 地面貼片要轉向:`rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `[hidden]` 面板修正已內建(styles.css 底部)。
- 溝通一律繁體中文;聖經皮經文必先 cuv 查驗。

## 驗證/部署

- `node scripts/verify-balaam.mjs <url> <outDir>`:完美避讓(零罰分)/全程不按(挨打)/換毛色,0 pageerror。
- 尚未部署(2026-07-16,只做本機):建 repo 名 `balaam-donkey3d`、Netlify 站名 `hfpc-balaam-donkey3d`(由主線統一 ship)。
