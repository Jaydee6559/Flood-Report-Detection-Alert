# Training the flood photo classifier

`train_mobilenetv2.ipynb` trains the photo classifier used by the "Report a flood" page. It:

1. downloads the Flood10K dataset from Mendeley,
2. cleans it (drops `.svg` files, broken files, duplicates and images under 64 px) and splits it 70/15/15,
3. fine-tunes an ImageNet-pretrained MobileNetV2 in two stages (frozen base, then the last 30 layers),
4. prints a cut-off table (validation) and a final test score,
5. saves the model to Google Drive as `flood_model.keras`.

The model takes a 224×224 RGB image with **raw 0–255 pixels** (it has its own `Rescaling` layer) and outputs
one number, P(flood). Classes: `no_flood` = 0, `flood` = 1.

## Dataset

Odebode, A.; Bennett Milburn, A. (2025), "Flood10k Dataset", Mendeley Data, V1,
doi:[10.17632/4sgcd7zdsp.1](https://doi.org/10.17632/4sgcd7zdsp.1). License: CC BY-NC 4.0 (non-commercial use only).

## Running it in Google Colab

1. Open the notebook in Colab:
   - **File → Upload notebook** and choose `training/train_mobilenetv2.ipynb`, or
   - once the repo is on GitHub, **File → Open notebook → GitHub** and paste the repo URL.
2. **Runtime → Change runtime type → T4 GPU.**
3. Create an empty folder `flood-model` in My Drive.
4. Run the cells from the top. Training takes roughly 15–30 minutes on a T4.
5. After a disconnect, re-run Steps 1–2 (Colab wipes `/content`, but Drive is kept).

## Where the model ends up

- `My Drive/flood-model/best.keras`: best checkpoint during training
- `My Drive/flood-model/flood_model.keras`: the final model (Cell I)

## Getting the model into the website

The model file is not committed to git (`flood-detection/models/*.keras` is in `.gitignore`), so each
teammate needs their own copy:

1. Download `flood_model.keras` from `My Drive/flood-model/` (or copy it from `G:\My Drive\flood-model\`
   if Google Drive for desktop is installed; the drive letter may differ). Not `best.keras`.
2. Copy it to `flood-detection/models/flood_model.keras`, or point the `FLOOD_MODEL` environment variable at it.
3. Install the requirements in a Python 3.12 venv (`pip install -r flood-detection/requirements.txt`) and start
   the app. `GET /api/model-status` should return `"ready": true`.

See `flood-detection/models/README.md` for more on the server side.

## Results

| Split | Cut-off | AUC | Precision | Recall |
|---|---|---|---|---|
| Validation | 0.50 | 0.992 | 0.961 | 0.949 |
| Validation | 0.80 | | 0.982 | 0.892 |
| Validation | 0.30 | | 0.944 | 0.972 |
| Test | 0.50 | 0.990 | 0.969 | 0.952 |

These support the agent's Rule 1 cut-offs (0.80 / 0.50 / 0.30). Flood10K photos differ from real Quezon City
street photos, so real reports will likely score lower.
