------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2018-2019, AdaCore                      --
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
with DFR0548; use DFR0548;
with HAL;     use HAL;

package MicroBit.MotorDriver is

   type Directions is (Forward,
                       Left,
                       Right,
                       Forward_Left,
                       Backward_Left,
                       Turning,
                       Lateral_Left,
                       Rotating_Left,
                       Stop);

   type Speeds is record
      rf: UInt12;
      rb: UInt12;
      lf: UInt12;
      lb: UInt12;
   end record;

   procedure Drive (Direction : Directions;
                    Speed : Speeds := (4095,4095,4095,4095));

   procedure Servo (ServoPin : ServoPins ;
                    Angle : Degrees);

private
   procedure Drive_Wheels(rf : Wheel;
                         rb : Wheel;
                         lf : Wheel;
                         lb : Wheel);

   procedure Initialize;

end MicroBit.MotorDriver;
