meta:
  id: test_crc32_trailer
seq:
  - id: framed
    size-eos: true
    process: kaitai.compress.crc32_trailer("B1gS")
    type: framed
instances:
  body:
    value: framed.body
types:
  framed:
    seq:
      - id: body
        size: _io.size - 4
      - id: crc
        type: u4le
