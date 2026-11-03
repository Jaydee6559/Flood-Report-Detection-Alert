# Trained model

Put the trained photo classifier here as **`flood_model.keras`**.

It is the MobileNetV2 model fine-tuned on Flood10K in Google Colab
(Odebode & Bennett Milburn, 2025, Mendeley Data, doi:10.17632/4sgcd7zdsp.1, CC BY-NC 4.0).

- Input: one 224 x 224 RGB photo with raw 0–255 pixels. The model scales them to [-1, 1] itself.
- Output: one number, P(flood), from 0 to 1. Class order in training: `no_flood` = 0, `flood` = 1.

Flask loads it on the first photo check (`app.py`, `POST /api/classify`).
To use a file somewhere else, set the `FLOOD_MODEL` environment variable to its path.

Results on the Flood10K splits (70 / 15 / 15):

| Set | AUC | Precision @0.50 | Recall @0.50 |
|---|---|---|---|
| Validation | 0.992 | 0.961 | 0.949 |
| Test | 0.990 | 0.969 | 0.952 |

Validation cut-offs: 0.80 → precision 0.982, recall 0.892 · 0.30 → precision 0.944, recall 0.972.
These support the agent's Rule 1 cut-offs (0.80 / 0.50 / 0.30). The "normal" images in Flood10K are mostly
general scenes, so expect lower scores on real Quezon City street photos until a QC test set is added.
