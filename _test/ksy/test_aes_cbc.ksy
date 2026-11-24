meta:
  id: test_aes_cbc
seq:
  - id: body
    size-eos: true
    process: kaitai.compress.block_cipher("aes", "cbc", "0123456789abcdef", "fedcba9876543210", "pkcs7")
