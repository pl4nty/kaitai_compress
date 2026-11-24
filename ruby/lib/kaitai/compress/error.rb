module Kaitai
  module Compress
    # Raised when encoded data is malformed (bad checksum, bad padding,
    # truncated stream, ...). Invalid process arguments raise ArgumentError.
    class Error < StandardError
    end
  end
end
