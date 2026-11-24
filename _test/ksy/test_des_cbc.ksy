meta:
  id: test_des_cbc
seq:
  - id: body
    size-eos: true
    process: kaitai.compress.block_cipher("des", "cbc", "S3crtMsG", "S3crtMsG")
