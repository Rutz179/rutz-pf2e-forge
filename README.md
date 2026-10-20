# Rutz's PF2e Forge

장비 내구도와 제작을 눈에 보이게 — 인벤토리에서 바로 보이는 HP 막대, 재질별 경도·HP, 수리, 전투 후 정비, 진행도가 보이는 제작 프로젝트.
*Item durability, repairs, post-combat upkeep and visible crafting projects for Pathfinder 2e.*

- **인벤토리 표시** — 무기·방어구·방패 이름 옆에 HP 막대와 파손 태그. 누르면 내구도 창이 열립니다.
- **재질별 내구도** — PF2e는 방패만 HP가 있지만, 무기·방어구도 GM Core 재료표(귀금속은 등급별)로 경도·HP·BT를 갖습니다.
- **수리** — 플레이어가 자기 캐릭터로 제작 판정을 굴려 규칙대로 회복. 파손된 방어구는 AC 페널티 효과가 자동으로 붙습니다.
- **피해 알림** — 아이템 HP가 줄면 소유자와 GM에게 귓속말.
- **전투 후 정비** — 전투가 끝나면 (켜 둔 경우) 장비 마모, 파티 HP·상태·집중 포인트 요약, 경험치 지급 창.
- **제작대** — 제작 판정 → 재료비 → 하루하루 진척(GM 배율 조정) → 언제든 남은 값을 내고 완성. 진행 중인 제작은 효과로 표시됩니다.

## 설치
```
https://github.com/Rutz179/rutz-pf2e-forge/releases/latest/download/module.json
```
Foundry VTT v13–v14 · PF2e. 캐릭터 시트 머리의 「내구도」「제작대」 버튼, 매크로 `game.rutzForge.durability(actor)` / `.workbench(actor)` / `.upkeep()`.
