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

with MicroBit.IOsForTasking; use MicroBit.IOsForTasking;
with HAL; use HAL;
package MicroBit.Music is

   type Pitch is new Natural;

   type Note is record
      P  : Pitch;
      Ms : Integer;
   end record;

   type Melody is array (Natural range <>) of Note;

   procedure Play (Pin : Pin_Id; P : Pitch);

   procedure Play (Pin : Pin_Id; N : Note);

   procedure Play (Pin : Pin_Id; M : Melody);

   function Midi_To_Freq_Hz(key : UInt8) return Pitch;

   Volume : Analog_Value := 20;
   IsPlaying : Boolean := False;
   procedure VolumeUp;

   procedure VolumeDown;

   --  Predefined notes --

   Rest: constant Pitch := 0;  -- https://newt.phys.unsw.edu.au/jw/notes.html
   A0  : constant Pitch := 28; -- these are rounded numbers and are off by max 0.5Hz!
   AS0 : constant Pitch := 29;
   B0  : constant Pitch := 31;
   C1  : constant Pitch := 33;
   CS1 : constant Pitch := 35;
   D1  : constant Pitch := 37;
   DS1 : constant Pitch := 39;
   E1  : constant Pitch := 41;
   F1  : constant Pitch := 44;
   FS1 : constant Pitch := 46;
   G1  : constant Pitch := 49;
   GS1 : constant Pitch := 52;
   A1  : constant Pitch := 55;
   AS1 : constant Pitch := 58;
   B1  : constant Pitch := 62;
   C2  : constant Pitch := 65;
   CS2 : constant Pitch := 69;
   D2  : constant Pitch := 73;
   DS2 : constant Pitch := 78;
   E2  : constant Pitch := 82;
   F2  : constant Pitch := 87;
   FS2 : constant Pitch := 93;
   G2  : constant Pitch := 98;
   GS2 : constant Pitch := 104;
   A2  : constant Pitch := 110;
   AS2 : constant Pitch := 117;
   B2  : constant Pitch := 123;
   C3  : constant Pitch := 131;
   CS3 : constant Pitch := 139;
   D3  : constant Pitch := 147;
   DS3 : constant Pitch := 156;
   E3  : constant Pitch := 165;
   F3  : constant Pitch := 175;
   FS3 : constant Pitch := 185;
   G3  : constant Pitch := 196;
   GS3 : constant Pitch := 208;
   A3  : constant Pitch := 220;
   AS3 : constant Pitch := 233;
   B3  : constant Pitch := 247;
   C4  : constant Pitch := 262;
   CS4 : constant Pitch := 277;
   D4  : constant Pitch := 294;
   DS4 : constant Pitch := 311;
   E4  : constant Pitch := 330;
   F4  : constant Pitch := 349;
   FS4 : constant Pitch := 370;
   G4  : constant Pitch := 392;
   GS4 : constant Pitch := 415;
   A4  : constant Pitch := 440;
   AS4 : constant Pitch := 466;
   B4  : constant Pitch := 494;
   C5  : constant Pitch := 523;
   CS5 : constant Pitch := 554;
   D5  : constant Pitch := 587;
   DS5 : constant Pitch := 622;
   E5  : constant Pitch := 659;
   F5  : constant Pitch := 698;
   FS5 : constant Pitch := 740;
   G5  : constant Pitch := 784;
   GS5 : constant Pitch := 831;
   A5  : constant Pitch := 880;
   AS5 : constant Pitch := 932;
   B5  : constant Pitch := 988;
   C6  : constant Pitch := 1_047;
   CS6 : constant Pitch := 1_109;
   D6  : constant Pitch := 1_175;
   DS6 : constant Pitch := 1_245;
   E6  : constant Pitch := 1_319;
   F6  : constant Pitch := 1_397;
   FS6 : constant Pitch := 1_480;
   G6  : constant Pitch := 1_568;
   GS6 : constant Pitch := 1_661;
   A6  : constant Pitch := 1_760;
   AS6 : constant Pitch := 1_865;
   B6  : constant Pitch := 1_976;
   C7  : constant Pitch := 2_093;
   CS7 : constant Pitch := 2_217;
   D7  : constant Pitch := 2_349;
   DS7 : constant Pitch := 2_489;
   E7  : constant Pitch := 2_637;
   F7  : constant Pitch := 2_794;
   FS7 : constant Pitch := 2_960;
   G7  : constant Pitch := 3_136;
   GS7 : constant Pitch := 3_322;
   A7  : constant Pitch := 3_520;
   AS7 : constant Pitch := 3_729;
   B7  : constant Pitch := 3_951;
   C8  : constant Pitch := 4_186;
   CS8 : constant Pitch := 4_435;
   D8  : constant Pitch := 4_699;
   DS8 : constant Pitch := 4_978;

    --Use LUT for Midi number to pitch conversion, eg. Midinumber 21 = A0 = NotesLut(21-offset=2) = Pitch/Frequency 28. Offset is 19.
   NotesLUT : constant array (1 .. 92) of Pitch :=
     (Rest, A0, AS0, B0, C1, CS1, D1, DS1, E1, F1, FS1, G1, GS1, A1, AS1, B1,
      C2, CS2, D2, DS2, E2, F2, FS2, G2, GS2, A2, AS2, B2, C3, CS3, D3, DS3,
      E3, F3, FS3, G3, GS3, A3, AS3, B3, C4, CS4, D4, DS4, E4, F4, FS4, G4,
      GS4, A4, AS4, B4, C5, CS5, D5, DS5, E5, F5, FS5, G5, GS5, A5, AS5, B5,
      C6, CS6, D6, DS6, E6, F6, FS6, G6, GS6, A6, AS6, B6, C7, CS7, D7, DS7,
      E7, F7, FS7, G7, GS7, A7, AS7, B7, C8, CS8, D8, DS8);

end MicroBit.Music;
