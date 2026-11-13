# 调研笔记：安静、退回自己、话用完了

适用心情：不想说话、想一个人待着、累到不想解释。调研于 2026-11-12，为《不想说话》所做。

## 四条可以直接用的手法

### 1. 长度不同的循环，永远对不齐（Brian Eno，《Music for Airports》）
- 怎么做：每条磁带循环上只录一个长音或三四个音的短句，几条循环长度各不相同，同时播放。因为长度不成整数倍，它们几乎不会在同一个位置重合。
- 效果：音乐不再「对你说话」，没有句子、没有方向，只是在那里。Eno 的目标是「可以被忽略，也可以被细听」。
- 代码里怎么用：给每个音一个自己的周期（比如 17、23、29 个十六分音符），各自循环。周期选互质的数。

### 2. 一个声部走音阶，另一个只弹主和弦的三个音（Arvo Pärt，钟鸣作曲法，《镜中镜》）
- 怎么做：旋律声部几乎只做级进（相邻的音），伴奏声部只在主和弦的三个音里选。速度从头到尾不变，节奏极简。乐句是「加法」：每句比上一句多一个音。
- 效果：极少的材料，听起来干净、静止、像钟声。
- 代码里怎么用：把「加法」反过来做成「减法」——每句比上一句少一个音，表达话越说越少。

### 3. 少弹音，留出还在响的空间（坂本龙一，《async》）
- 怎么做：他说要「更少的音，更多的空间」，并且强调是空间不是静默，因为空间里余音还在响。让每个音自然衰减完再弹下一个。专辑里还用了一台被海啸泡过、音不准的钢琴。
- 效果：留白不是空的，是在听上一个音怎么消失。
- 代码里怎么用：音与音之间隔得很开，混响拉长，音符时值拉到让它自己衰减完；音高可以轻微不准。

### 4. 挂留和弦与抽走音乐（电影配乐的通用做法）
- 怎么做：挂留和弦是把和弦里决定「开心还是难过」的那个音拿掉，换成旁边的音，听起来悬着、没说完。和声可以 8–16 小节不动。观众已经习惯有音乐时，突然把它抽走，会让人感到暴露和真实。
- 效果：不表态、不解决；撤走比加入更有力量。
- 代码里怎么用：和弦去掉三音；乐器一件件撤走而不是淡出。

## 来源
- https://reverbmachine.com/blog/deconstructing-brian-eno-music-for-airports/
- https://en.wikipedia.org/wiki/Tintinnabuli
- https://interlude.hk/arvo-part-spiegel-im-spiegel/
- https://www.thefader.com/2017/05/05/ryuichi-sakamoto-async-interview
- https://pioneerworks.org/broadcast/ruth-saxelby-ryuichi-sakamoto-piano
- https://loststoriesacademy.com/blogs-and-tutorials/the-secret-music-theory-behind-background-scores-why-movie-music-feels-so-powerful

注意：坂本龙一的引语来自搜索摘要，未逐字核对原访谈。
