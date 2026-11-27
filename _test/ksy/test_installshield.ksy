meta:
  id: test_installshield
seq:
  - id: body
    size-eos: true
    process: kaitai.compress.installshield("Setup.ini", true)
