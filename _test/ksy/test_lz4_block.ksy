meta:
  id: test_lz4_block
  endian: le
seq:
  - id: len_uncompressed
    type: u4
    doc: Size prefix as written by python-lz4 `lz4.block.compress(store_size=True)`.
  - id: body
    size-eos: true
    process: kaitai.compress.lz4_block(len_uncompressed)
