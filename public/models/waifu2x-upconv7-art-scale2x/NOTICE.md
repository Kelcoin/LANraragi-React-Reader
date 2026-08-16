# Waifu2x UpConv7 art scale2x model

- Source: `nagadomi/nunif`, pinned commit `eab6952d93e85951ed4e4cff30cd26c09e1dbb63`, `pretrained_models/waifu2x/upconv_7/art/scale2x.pth`.
- License: MIT.
- Export: PyTorch 2.11 dev fixed `240x240` input to `452x452` output; `onnx==1.22.0` and `onnxconverter-common==1.16.0` conversion with FP32 input/output and internal FP16.
- Tensors: input `x` FP32 NCHW `[1, 3, 240, 240]`; output `y` FP32 NCHW `[1, 3, 452, 452]`.
- Geometry: 2x scale, `tileCore=226`, `padding=7`, `outputInset=7`.
- SHA-256: `d6e851231688b239425e5cb05632a434bdbc58c076686dc69bd7e539d1680961`.
