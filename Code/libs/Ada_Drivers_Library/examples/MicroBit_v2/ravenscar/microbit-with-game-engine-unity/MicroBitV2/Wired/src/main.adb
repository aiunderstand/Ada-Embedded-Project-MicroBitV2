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

with Ada.Real_Time; use Ada.Real_Time;
use MicroBit;

procedure Main is

   Data: All_Axes_Data;
   Jump : constant MicroBit.Music.Melody :=
   ((C4,   50),
    (G3,   50));
   My_Little_Melody : constant MicroBit.Music.Melody :=
   ((C4,   400),
   (G3,   800),
   (B3,   400),
   (Rest, 400),
   (A3,   400),
   (G3,   400));
   Threshold : constant := 150;
begin
   Put_Line (""); --send empty message since Ada runtime sends a zero symbol on the serial at bootup.
   --Send reset signal to unity
   Put_Line ("RST");

   Play(27,My_Little_Melody); --startup sound
   Play(27,My_Little_Melody); --startup sound

   loop


      --  Read the accelerometer data
      Data := Accelerometer.AccelData;

      --  Print the ACC data on the serial port. Note the special format for the Unity simulator!
      Put_Line ("ACC;" &
                "X,"  & Data.X'Img & ";" &
                "Y,"  & Data.Y'Img & ";" &
                "Z,"  & Data.Z'Img);


      --  Clear the LED matrix
      MicroBit.DisplayRT.Clear;

      --  Draw a symbol on the LED matrix depending on the orientation of the
      --  micro:bit.
      if Data.X > Threshold then
         MicroBit.DisplayRT.Symbols.Left_Arrow;

          --  Print the LED data on the serial port. Note the special format for the Unity simulator!
         Put_Line ("LED;"  &
                   "0,0;"  & "1,0;"  & "2,1;"  & "3,0;"  & "4,0;"  &
                   "5,0;"  & "6,1;"  & "7,0;"  & "8,0;"  & "9,0;"  &
                   "10,1;" & "11,1;" & "12,1;" & "13,1;" & "14,1;" &
                   "15,0;" & "16,1;" & "17,0;" & "18,0;" & "19,0;" &
                   "20,0;" & "21,0;" & "22,1;" & "23,0;" & "24,0" );


      elsif Data.X < -Threshold then
         MicroBit.DisplayRT.Symbols.Right_Arrow;
         Put_Line ("LED;"  &
                   "0,0;"  & "1,0;"  & "2,1;"  & "3,0;"  & "4,0;"  &
                   "5,0;"  & "6,0;"  & "7,0;"  & "8,1;"  & "9,0;"  &
                   "10,1;" & "11,1;" & "12,1;" & "13,1;" & "14,1;" &
                   "15,0;" & "16,0;" & "17,0;" & "18,1;" & "19,0;" &
                   "20,0;" & "21,0;" & "22,1;" & "23,0;" & "24,0" );

      elsif Data.Y > Threshold then
         DisplayRT.Symbols.Up_Arrow;
         Put_Line ("LED;" &
                   "0,0;"  & "1,0;"  & "2,1;"  & "3,0;"  & "4,0;"  &
                   "5,0;"  & "6,1;"  & "7,1;"  & "8,1;"  & "9,0;"  &
                   "10,0;" & "11,0;" & "12,1;" & "13,0;" & "14,0;" &
                   "15,0;" & "16,0;" & "17,1;" & "18,0;" & "19,0;" &
                   "20,0;" & "21,0;" & "22,1;" & "23,0;" & "24,0" );

      elsif Data.Y < -Threshold then
         MicroBit.DisplayRT.Symbols.Down_Arrow;
         Put_Line ("LED;" &
                   "0,0;"  & "1,0;"  & "2,1;"  & "3,0;"  & "4,0;"  &
                   "5,0;"  & "6,0;"  & "7,1;"  & "8,0;"  & "9,0;"  &
                   "10,0;" & "11,0;" & "12,1;" & "13,0;" & "14,0;" &
                   "15,0;" & "16,1;" & "17,1;" & "18,1;" & "19,0;" &
                   "20,0;" & "21,0;" & "22,1;" & "23,0;" & "24,0" );

      else
         MicroBit.DisplayRT.Symbols.Heart;
         Put_Line ("LED;" &
                   "0,0;"  & "1,1;"  & "2,0;"  & "3,1;"  & "4,0;"  &
                   "5,1;"  & "6,0;"  & "7,1;"  & "8,0;"  & "9,1;"  &
                   "10,1;" & "11,0;" & "12,0;" & "13,0;" & "14,1;" &
                   "15,0;" & "16,1;" & "17,0;" & "18,1;" & "19,0;" &
                   "20,0;" & "21,0;" & "22,1;" & "23,0;" & "24,0" );
      end if;



      -- Read buttons
      if MicroBit.Buttons.State (Button_A) = Pressed then
          --  Print the BTN data on the serial port. Note the special format for the Unity simulator!
         Put_Line ("BTN;A,1");
      else
         Put_Line ("BTN;A,0");
      end if;

      if MicroBit.Buttons.State (Button_B) = Pressed then
         Put_Line ("BTN;B,1");
         Play(27, Jump); -- Play a "jump" sound. Note that for long melodies we need to implement tasking so that the execution can yield to another task while the note is being played by the hardware
      else
         Put_Line ("BTN;B,0");
      end if;

      if MicroBit.Buttons.State (Logo) = Pressed then
           Put_Line ("BTN;L,1");
      else
         Put_Line ("BTN;L,0");
      end if;



      --  Do nothing for 100 milliseconds
       delay until Clock + Milliseconds(100);
   end loop;
end Main;
