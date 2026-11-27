meta:
  id: test_crc32_chunks
seq:
  - id: body
    size-eos: true
    process: kaitai.compress.crc32_chunks(4096)
