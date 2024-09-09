------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2019, AdaCore                        --
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

with MicroBit.MotorDriver; use MicroBit.MotorDriver; --using the procedures defined here
with DFR0548;  -- using the types defined here

with MicroBit.Console; use MicroBit.Console; -- for serial port communication
with MicroBit.Time; use MicroBit.Time; -- for time facilities
use MicroBit; --for pin names

procedure Main is

begin
   MotorDriver.Servo(1,90);
   Time.Sleep (1000);

   loop
      -- DEMONSTRATION ROUTINE 4 MOTORS (useful for checking your wiring)
      MotorDriver.Drive(Forward,(4095,0,0,0)); --right front wheel to M4
      Time.Sleep (1000);
      MotorDriver.Drive(Forward,(0,4095,0,0)); --right back wheel to M3
      Time.Sleep (1000);
      MotorDriver.Drive(Forward,(0,0,4095,0)); --left front wheel to M2
      Time.Sleep (1000);
       MotorDriver.Drive(Forward,(0,0,0,4095)); --left back wheel to M1
      Time.Sleep (1000); -- wait a bit longer, before doing the loop again
      MotorDriver.Drive(Stop);

      -- DEMONSTRATION ROUTINE SERVO
      for I in reverse DFR0548.Degrees range 0..90 loop
         MotorDriver.Servo(1,I);
         Time.Sleep (20);
      end loop;

      for I in DFR0548.Degrees range 90..180 loop
         MotorDriver.Servo(1,I);
         Time.Sleep (20);
      end loop;

      for I in reverse DFR0548.Degrees range 90..180 loop
         MotorDriver.Servo(1,I);
         Time.Sleep (20);
      end loop;

   end loop;
end Main;
