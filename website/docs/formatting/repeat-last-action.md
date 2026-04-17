---
id: repeat-last-action
title: Repeat Last Action (F4)
sidebar_label: Repeat Last Action
---

# Repeat Last Action (F4)

Press **F4** to repeat the last formatting or structural action you applied — exactly like Excel's F4. This saves time when you need to apply the same format to multiple non-contiguous cells.

---

## Actions That Can Be Repeated

| Action | Can Repeat? |
|---|---|
| Bold | ✅ |
| Italic | ✅ |
| Text alignment (left/center/right) | ✅ |
| Background color | ✅ |
| Text color | ✅ |
| Number format | ✅ |
| Column resize | ✅ |
| Row resize | ✅ |
| Border style | ✅ |
| Cell clear | ❌ |
| Data saves | ❌ |

---

## Example Workflow

1. Select cell A5, apply **bold** and **red background**
2. Press Ctrl+C to copy the style? — No, easier: just select another cell
3. Navigate to D12
4. Press **F4** — bold + red background applied instantly

Repeat as many times as needed.

---

## Technical Note

F4 is intercepted by Excel View before Handsontable (which uses F4 for a different purpose). The interception is done at the `beforeKeyDown` level with `stopImmediatePropagation` to prevent conflicts.
