with Ada.Real_Time; use Ada.Real_Time;
with MicroBit.Console; use MicroBit.Console ;
use MicroBit;
with Ada.Execution_Time; use Ada.Execution_Time;

package body Brain is

   task body Sense is
      Time_Now_Stopwatch : Time;
      Time_Now_CPU : CPU_Time;
      Elapsed_Stopwatch : Time_Span;
      Elapsed_CPU : Time_Span;
      AmountOfMeasurement: Integer := 10; -- do 10 measurement and average
   begin
      loop
            Elapsed_Stopwatch := Time_Span_Zero;
            Elapsed_CPU := Time_Span_Zero;

            for Index in 1..AmountOfMeasurement loop
               Time_Now_Stopwatch := Clock;
               Time_Now_CPU := Clock;

               delay 0.03; --simulate execution time = 30 ms.

               Elapsed_CPU := Elapsed_CPU + (Clock - Time_Now_CPU);
               Elapsed_Stopwatch := Elapsed_Stopwatch + (Clock - Time_Now_Stopwatch);
            end loop;

            Elapsed_CPU := Elapsed_CPU / AmountOfMeasurement;
            Elapsed_Stopwatch := Elapsed_Stopwatch / AmountOfMeasurement;

            Put_Line ("Average CPU time: " & To_Duration (Elapsed_CPU)'Image & " seconds");
            Put_Line ("Average Stopwatch time: " & To_Duration (Elapsed_Stopwatch)'Image & " seconds");

      end loop;
   end Sense;
end Brain;
