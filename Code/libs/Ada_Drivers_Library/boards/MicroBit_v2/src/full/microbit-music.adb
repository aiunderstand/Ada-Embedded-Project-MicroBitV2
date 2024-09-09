------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2018, AdaCore                        --
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
with Ada.Real_Time; use Ada.Real_Time;
--with MicroBit.Console; use MicroBit.Console;
--use MicroBit;
package body MicroBit.Music is

   procedure VolumeUp is
      begin
      if Volume + 10 < Analog_Value'Last then
         Volume := Volume +10;
      end if;

      if IsPlaying then
         Write (27, Volume); --adjust volume of currently played tone
      end if;
   end VolumeUp;

   procedure VolumeDown is
       begin
          if Volume - 10 >= Analog_Value'First then
         Volume := Volume -10;
      end if;

      if IsPlaying then
         Write (27, Volume);
      end if;
   end VolumeDown;

   function Midi_To_Freq_Hz(key : UInt8) return Pitch is
   test:Integer;
   begin
      if key = 0 then
          --Put_Line("Stop: " & key'Image);
         return NotesLut(1); --Rest
      else
         --Put_Line("Key: " & key'Image);
         test := Integer(key) - 19;
         --Put_Line("Index: " & test'Image);

         return NotesLut(test);  --key 21 (the lowest key, A0) at index 2 so offset is 21-19=2, so 19.
      end if;
   end Midi_To_Freq_Hz;


   ----------
   -- Play --
   ----------

   procedure Play
     (Pin : Pin_Id;
      P : Pitch)
   is
   begin
      if P = Rest then
         IsPlaying := False;
         --  Disable PWM on the pin by giving it a digital value
         Set (Pin, False);
      else
         IsPlaying := True;
         --  Enable PWM with a 50% duty cycle
         Write (Pin, Volume); --512 =50%, but https://github.com/bbcmicrobit/micropython/blob/master/source/microbit/modmusic.cpp use 128?

         --  Set the period corresponding to the required pitch
         Set_Analog_Period_Us (1_000_000 / Natural (P));
      end if;
   end Play;

   ----------
   -- Play --
   ----------

   procedure Play (Pin : Pin_Id; N : Note) is
   begin
      Play (Pin, N.P);
      delay until Clock + Milliseconds(N.Ms);
      IsPlaying := False;
   end Play;

   ----------
   -- Play --
   ----------

   procedure Play (Pin : Pin_Id; M : Melody) is
   begin
      for N of M loop
         Play (Pin, N);
      end loop;

      Set (Pin, False); --stop
   end Play;

begin
   -- Initialize PWM
    Set_Analog_Period_Us (1_000_000 / 125);
end MicroBit.Music;
