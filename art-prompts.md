# 流派卡插圖 prompt（ComfyUI 用）

22 張流派卡都已經有圖（前 6 張用 Hugging Face 生，後 12 張用本機 ComfyUI Z-Image 生，合氣道用第二版）。這份留著之後重生或換圖用。

每張 = 「主體」+ 共用風格尾巴。建議 1024×1024，出圖後放 `src/art/<id>.webp`（72×72，約 1.5 KB）：

```bash
cwebp -quiet -crop 112 112 800 800 -resize 72 72 -q 78 原圖.png -o src/art/<id>.webp
```

**共用風格尾巴（接在主體後面）：**

```
Painterly concept art, volumetric spotlight through haze, dark arena, strong rim light, deep navy shadows with hazard yellow and red accents, high contrast, bold readable silhouette, centered composition, no text, no letters, no people
```

**共用開頭：** `Dramatic cinematic key art, gritty underground robot fighting league.`

**Negative（ComfyUI 用）：** `text, letters, watermark, logo, human, person, blurry, multiple robots crowded, cropped head`

| id | 流派 | 主體 |
|---|---|---|
| karate | 空手道 | A boxy white-plated fighting robot in a deep front stance throwing a straight reverse punch, black belt sash around its waist |
| taekwondo | 跆拳道 | A slim lightweight robot with long legs mid-air spinning high kick, leg fully extended above head height |
| muaythai | 泰拳 | A robot with elbow blades driving a rising knee strike, red rope armbands, mongkol-style headband ring on its head |
| kickboxing | 踢拳 | A robot in padded gloves throwing a roundhouse kick to the ribs, guard up, sweat-like sparks flying |
| wingchun | 詠春 | A compact robot with rapid chain punches, multiple motion-blurred fists in a straight centerline, wooden training dummy beside it |
| judo | 柔道 | A heavy robot in a white gi-like plated jacket throwing another robot over its shoulder in a big arc |
| wrestling | 摔角 | A bulky robot shooting a double-leg takedown, lifting a second robot off the ground at the waist |
| bjj | 巴西柔術 | A robot on its back on the mat locking another robot's arm in an armbar, dramatic top-down view |
| aikido | 合氣道 | A calm robot in a flowing dark hakama-like skirt redirecting an attacker's punch into a spinning circular throw, swirl of air |
| sumo | 相撲 | A massive round heavyweight robot in a thick rope belt, crouched low in a ring of salt-white dust, slapping its hands forward |
| capoeira | 卡波耶拉 | An acrobatic robot doing a handstand cartwheel kick, legs spinning in a wide arc, golden sparks trailing |
| jkd | 截拳道 | A lean yellow-striped robot intercepting with a sharp side kick, minimal stance, thumb wiping its faceplate |
| kravmaga | 以色列格鬥術 | A tactical-armored robot blocking with one forearm while striking the throat area with the other hand, aggressive forward lunge |
| sambo | 桑搏 | A robot in a red jacket-like plated torso catching an opponent's leg and twisting it into a leglock takedown |
| savate | 法式踢拳 | An elegant robot with pointed shoe-like feet throwing a high fouetté kick with the toe, one arm raised in guard |
| lethwei | 緬甸拳 | A scarred battered robot with bare taped fists lunging forward with a headbutt, sparks bursting from impact |
| kyokushin | 極真空手 | A thick-armored robot standing firm taking a blow to the chest without flinching while throwing a low kick, cracked plating |
| sanda | 散打 | A robot catching a kick under its arm and sweeping the standing leg out, opponent tipping over |
