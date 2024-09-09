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

with LSM303AGR; use LSM303AGR;

with MicroBit.DisplayRT;
with MicroBit.DisplayRT.Symbols;
with MicroBit.Accelerometer;
with MicroBit.Console; use MicroBit.Console;
with MicroBit.Buttons; use MicroBit.Buttons;
with MicroBit.Music; use MicroBit.Music;
with MicroBit.Radio; use MicroBit.Radio;

with HAL; use HAL;
with Ada.Real_Time; use Ada.Real_Time;
use MicroBit;

procedure Main with Priority => 1 is

   Data: All_Axes_Data_Raw;
   Jump : constant MicroBit.Music.Melody :=
   ((C4,   40),
    (G3,   40));
   My_Little_Melody : constant MicroBit.Music.Melody :=
   ((C4,   400),
   (G3,   800),
   (B3,   400),
   (Rest, 400),
   (A3,   400),
   (G3,   400));
   Threshold : constant := 150;
   MyClock : Time;
   TxData : Radio.RadioData;
   X,Y,Z : Axis_Data;
begin

   TxData.Length := 3+12;
   TxData.Version:= 12;
   TxData.Group := 1;
   TxData.Protocol := 14;

   Radio.Setup(RadioFrequency => 2407,
               Length => TxData.Length,
               Version => TxData.Version,
               Group => TxData.Group,
               Protocol => TxData.Protocol);

   Radio.StartReceiving;
   Put_Line(Radio.State); -- this should report Status: 3, meaning in RX mode

   --This radio message is used as a hacky reset message to notify this controller has reset and Unity should also reset "game".
   --Payload 1tm6 are used by the ACC. The ACC has a low and high byte but the result can never be higher than 12 bit.
   --By setting both bytes to 255 an impossible value is reached which we read out at the radio receiver side.
   TxData.Payload(1) := 16#FF#; --X Low
   TxData.Payload(2) := 16#FF#; --X High
   Radio.Transmit(TXdata); --transmit reset instruction
   delay 0.1;
   --Play(27,My_Little_Melody); --startup sound
   --Play(27,My_Little_Melody); --startup sound
   loop
      MyClock := Clock; --reset myclock;

      --  Read the raw accelerometer data in bytes. Specsheet says 16 bits (2 bytes) per Channel, but value used in driver Axel_Data is 10 bits
      Data := Accelerometer.AccelDataRaw;

      TxData.Payload(1) := Data.X.Low;  --X Low
      TxData.Payload(2) := Data.X.High; --X High
      TxData.Payload(3) := Data.Y.Low;  --Y Low
      TxData.Payload(4) := Data.Y.High; --Y High
      TxData.Payload(5) := Data.Z.Low;  --Z Low
      TxData.Payload(6) := Data.Z.High; --Z High

      --convert it to Axis_Data format so we can use it
      X:= LSM303AGR.Convert(Data.X.Low, Data.X.High) * Axis_Data (-1);
      Y:= LSM303AGR.Convert(Data.Y.Low, Data.Y.High);
      Z:= LSM303AGR.Convert(Data.Z.Low, Data.Z.High);

      --  Clear the LED matrix
      MicroBit.DisplayRT.Clear;

      --  Draw a symbol on the LED matrix depending on the orientation of the
      --  micro:bit.

      if X > Threshold then
         MicroBit.DisplayRT.Symbols.Left_Arrow;

         TxData.Payload(7) := 2#0000_0100#;  --ROW1
         TxData.Payload(8) := 2#0000_1000#;  --ROW2
         TxData.Payload(9) := 2#0001_1111#;  --ROW3
         TxData.Payload(10) := 2#0000_1000#;  --ROW4
         TxData.Payload(11) := 2#0000_0100#;  --ROW5

      elsif X < -Threshold then
         MicroBit.DisplayRT.Symbols.Right_Arrow;

         TxData.Payload(7) := 2#0000_0100#;  --ROW1
         TxData.Payload(8) := 2#0000_0010#;  --ROW2
         TxData.Payload(9) := 2#0001_1111#;  --ROW3
         TxData.Payload(10) := 2#0000_0010#;  --ROW4
         TxData.Payload(11) := 2#0000_0100#;  --ROW5

      elsif Y > Threshold then
         DisplayRT.Symbols.Up_Arrow;

         TxData.Payload(7) := 2#0000_0100#;  --ROW1
         TxData.Payload(8) := 2#0000_1110#;  --ROW2
         TxData.Payload(9) := 2#0001_0101#;  --ROW3
         TxData.Payload(10) := 2#0000_0100#;  --ROW4
         TxData.Payload(11) := 2#0000_0100#;  --ROW5

      elsif Y < -Threshold then
         MicroBit.DisplayRT.Symbols.Down_Arrow;

         TxData.Payload(7) := 2#0000_0100#;  --ROW1
         TxData.Payload(8) := 2#0000_0100#;  --ROW2
         TxData.Payload(9) := 2#0001_0101#;  --ROW3
         TxData.Payload(10) := 2#0000_1110#;  --ROW4
         TxData.Payload(11) := 2#0000_0100#;  --ROW5

      else
         MicroBit.DisplayRT.Symbols.Heart;

         TxData.Payload(7) := 2#0000_1010#;  --ROW1
         TxData.Payload(8) := 2#0001_0101#;  --ROW2
         TxData.Payload(9) := 2#0001_0001#;  --ROW3
         TxData.Payload(10) := 2#0000_1010#;  --ROW4
         TxData.Payload(11) := 2#0000_0100#;  --ROW5
      end if;

     -- Read buttons
      TxData.Payload(12) := 2#0000_0000#; --all buttons are released
                                          -- btn A is first bit, btn B is second bit, logo is third bit
      if MicroBit.Buttons.State (Button_A) = Pressed then
         TxData.Payload(12) := 2#001#;  -- btn A is pressed
      end if;

      if MicroBit.Buttons.State (Button_B) = Pressed then
         TxData.Payload(12) := TxData.Payload(12) or 2#010#; --btn B is pressed (and potentially btn A as well, hence the or)
         Play(27, Jump); -- Play a "jump" sound. Note that for long melodies we need to implement tasking so that the execution can yield to another task while the note is being played by the hardware
      end if;

      if MicroBit.Buttons.State (Logo) = Pressed then
          TxData.Payload(12) := TxData.Payload(12) or 2#100#; --logo is pressed (and potentially btn A and/or B as well, hence the or)
      end if;

      Radio.Transmit(TXdata); --transmit all data

      --  Repeat every 50 ms
       delay until MyClock + Milliseconds(50);
   end loop;
end Main;
