with Delay_Aux_Pkg; -- this clock package is using Ada.Real_Time so its limit is 30us resolution.
with MicroBit.Console; use MicroBit.Console;
with Ada.Real_Time; use Ada.Real_Time;

use MicroBit;

--This example shows what happens when the execution time overshoots the period

procedure Main with Priority => 0 is --Set Interrupt Priorty P to 0, the lowest priority   
   package Aux renames Delay_Aux_Pkg;
    Cycle : constant Time_Span := Milliseconds (1000);
    Next  : Time := Aux.Get_Start_Time + Cycle;
    Cnt   : Integer := 1;
begin
   loop
      delay until Next;

      Aux.Show_Elapsed_Time;
      Aux.Computational_Intensive_App; -- we have set the execution time to be 990 ms. What happens if the execution time is 999ms?

      Put_Line ("Cycle # " & Integer'Image (Cnt));
      Cnt  := Cnt + 1;
      Next := Next+ Cycle;
   end loop;
end Main;
