------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2016, AdaCore                        --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------

package MicroBit.Time.Highspeed is
   subtype Time_Us is UInt64;

   -- Higher delays become more accurate
   -- 2 us pulses can be reached if Delay is set to 1. These are blocking calls and implemented using assembly NOP instructions so not precise
   -- A 64MHz clock (systick) signal would be more accurate to use and count 64 pulses for 1 us.
   -- There will always be a slight delay when toggling a pin. Toggling in hardware using use PPI and TE has the least delay.
   procedure Delay_Us (Microseconds : UInt64); -- warning: this hacky implementation is not really a clock.
                                               -- after starting the external high frequency crystal
                                               -- NOP assembly instructions were added until oscilloscope showed reasonable alignment
                                               -- the best range is between 2us and 1000us (1ms). For higher duration timing use the standard ada.real_time facilities
                                               -- this function is a blocking function, consumes a lot of power and is very sensitive to
                                               -- interrupts, which will completely destroy timing. In short, use with extreme care.
end MicroBit.Time.Highspeed;                    -- a better implementation would use the 64MHz SysTick and count 64 pulses for 1 us.
