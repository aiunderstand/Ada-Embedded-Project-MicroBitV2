with Ada.Numerics.Elementary_Functions; use Ada.Numerics.Elementary_Functions;
with Ada.Numerics; use Ada.Numerics;
with MicroBit.Console; use MicroBit.Console;
use MicroBit;

procedure Main is
x: Float;
begin
      x := Sin(Pi);
      Put_Line("Sin: " & x'Image);
      x := Sin(Pi/2.0);
      Put_Line("Sin: " & x'Image);
      x := Sin(3.0);
      Put_Line("Sin: " & x'Image);

loop
   null;
end loop;

end Main;
